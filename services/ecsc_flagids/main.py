# ECSC flagid fetcher
import typing
import httpx
import psycopg
import psycopg_pool
import pydantic
import pydantic_settings
import pathlib
import urllib
import urllib.parse
import time
import datetime


class Settings(pydantic_settings.BaseSettings):
    enabled: bool = False
    # url to connect to the database: "postgres://"
    db: pydantic.PostgresDsn
    teamid: int
    # leave empty to disable cache
    cache_path: pathlib.Path | None = pydantic.Field(default=pathlib.Path("/data/cache.json"))
    scoreboard_attackinfo_url: pydantic.HttpUrl = pydantic.Field(default=pydantic.HttpUrl("http://10.42.251.2:8080/api/v1/attack_info"))
    # ensure we dont try to add 
    fetch_all_flagids_from_database_on_start: bool = True
    game_starttime: datetime.datetime
    game_round_duration: int # ms

class Cache(pydantic.BaseModel):
    successfully_fetched_rounds: typing.Set[int] = set()
    all_flagids: typing.Set[str] = set()


class RoundFlagIdInfo(typing.NamedTuple):
    round_id: int
    flag_ids: typing.List[str]

def parse_flagids(round_id: int, flag_ids: typing.Any) -> RoundFlagIdInfo | None:
    if not isinstance(flag_ids, dict):
        raise ValueError(f"Invalid response for round {round_id}, expected dict, got {type(flag_ids)}")
    service_count = len(flag_ids)
    if service_count == 0:
        print(f"Round {round_id} has no services (down? no game?)")
        # none indicates service down, try again. as long as at least one service is in the list, the round is valid
        return None
    flagids: typing.List[str] = []
    for service, flag_stores in flag_ids.items():
        if not isinstance(flag_stores, dict):
            raise ValueError(f"Invalid response for round {round_id}, service {service}, expected dict, got {type(flag_stores)}")
        for store, flaginfo in flag_stores.items():
            if flaginfo is None:
                print(f"Round {round_id} service {service} store {store} has no flags (service down?)")
                continue
            if not isinstance(flaginfo, str):
                raise ValueError(f"Invalid response for round {round_id}, service {service}, store {store}, expected str | 'null', got {type(flaginfo)}")
            flagids.append(flaginfo)

    print(f"Round {round_id} has {len(flagids)} flagids in {service_count} services")
    # flagids may be empty if all services are down, but that round is valid, 
    # and wont be fetched again (or updated later by the gameserver)
    return RoundFlagIdInfo(round_id=round_id, flag_ids=flagids)

def time_to_round(starttime: datetime.datetime, round_duration_ms: int, t: datetime.datetime | None = None) -> int:
    if t is None:
        t = datetime.datetime.now(tz=starttime.tzinfo)
    if t < starttime:
        return 0
    delta = t - starttime
    delta_ms = (delta.days * 86400 + delta.seconds) * 1000 + delta.microseconds // 1000
    return delta_ms // round_duration_ms

def round_to_time(starttime: datetime.datetime, round_duration_ms: int, round: int) -> datetime.datetime:
    if round < 1:
        return starttime
    delta_ms = (round) * round_duration_ms
    delta = datetime.timedelta(milliseconds=delta_ms)
    return starttime + delta

def fetch_flagids(base_url: pydantic.HttpUrl, teamid: int, round: int | None = None) -> typing.List[RoundFlagIdInfo]:
    params = {
        "team": str(teamid),
    }
    if round is not None:
        params["round"] = str(round)
    
    url = urllib.parse.urljoin(str(base_url), "?" + urllib.parse.urlencode(params))
    print(f"Fetching flagids from {url}")
    with httpx.Client() as client:
        response = client.get(url)
        # once game starts, always returns 200
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError(f"Invalid response, expected dict, got {type(data)}")
        if round is None:
            # parse (potentially) multiple rounds in the response, dict[round_id, service_flag_ids]
            returned_rounds_count = len(data.keys())
            if returned_rounds_count == 0:
                # raise ValueError("No flagids returned for default round")
                # soft fail, occurs before/after game
                print("No flagids returned for default round")
                return []
            
            successful_rounds = []
            for returned_round_id, flag_ids in sorted(data.items(), key=lambda item: int(item[0]), reverse=True):
                result = parse_flagids(int(returned_round_id), flag_ids)
                if result is not None:
                    successful_rounds.append(result)
            return successful_rounds
        else:
            # parse single round, directly in the response
            result = parse_flagids(round, data)
            if result is None:
                return []
            else:
                return [result]




def add_flagids_to_database(db: psycopg_pool.ConnectionPool, flags: typing.List[str]):
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO flag_id (content) VALUES (%s)", flags)
            conn.commit()

def get_current_flagids_from_database(db: psycopg_pool.ConnectionPool) -> typing.Set[str]:
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT content FROM flag_id")
            rows = cur.fetchall()
            return {row[0] for row in rows if row[0] is not None}

def get_missing_rounds(latest_round: int, cached_rounds: typing.Set[int]) -> typing.List[int]:
    return [r for r in range(latest_round, 0, -1) if r not in cached_rounds]

def load_cache(path: pathlib.Path | None) -> Cache:
    if path is None:
        print("No cache path configured, using in-memory cache")
        return Cache()
    if not path.exists():
        print(f"Cache file {path} does not exist, starting with empty cache")
        return Cache()
    try:
        cache = Cache.model_validate_json(path.read_text())
        print(f"Loaded cache from {path}, {len(cache.successfully_fetched_rounds)} rounds, {len(cache.all_flagids)} flagids")
        return cache
    except Exception as e:
        # dont overwrite cache if it cant be loaded
        raise RuntimeError(f"Failed to load cache from {path}") from e
    
def save_cache(path: pathlib.Path | None, cache: Cache):
    if path is None:
        return
    try:
        path.write_text(cache.model_dump_json(indent=2))
    except Exception as e:
        print(cache.model_dump_json())
        raise RuntimeError(f"Failed to save cache to {path}") from e

def ingest_flagids(roundflagids: typing.List[RoundFlagIdInfo], cache: Cache, db: psycopg_pool.ConnectionPool):
    flagids = []
    for round, round_flagids in roundflagids:
        flagids.extend(round_flagids)
        if round in cache.successfully_fetched_rounds:
            print(f"Round {round} already in cache?")
        cache.successfully_fetched_rounds.add(round)
    new_flagids = [f for f in flagids if f not in cache.all_flagids]
    print(f"Ingesting {len(round_flagids)} rounds, composed of {len(flagids)} flagids ({len(new_flagids)} new to insert)")
    if len(new_flagids) > 0:
        # add_flagids_to_database(db, new_flagids)
        cache.all_flagids.update(new_flagids)
    

if __name__ == "__main__":
    settings = Settings()
    print("Settings:", settings)

    if not settings.enabled:
        print("ECSC flagid fetcher disabled, forever sleeping")
        while True:
            time.sleep(3600)

    cache = load_cache(settings.cache_path)
    save_cache(settings.cache_path, cache)

    db: psycopg_pool.ConnectionPool[psycopg.Connection] = psycopg_pool.ConnectionPool(str(settings.db))
    print("Connected to database")

    if settings.fetch_all_flagids_from_database_on_start:
        print("Fetching all existing flagids from database")
        existing_flagids = get_current_flagids_from_database(db)
        print(f"Found {len(existing_flagids)} existing flagids in database")
        before_count = len(cache.all_flagids)
        cache.all_flagids.update(existing_flagids)
        after_count = len(cache.all_flagids)
        if after_count > before_count:
            print(f"Added {after_count - before_count} flagids to cache from database")
            save_cache(settings.cache_path, cache)
    
    # wait until game start
    now = datetime.datetime.now(tz=settings.game_starttime.tzinfo)
    print(f"Current time: {now.isoformat()}, game starts at {settings.game_starttime.isoformat()}")
    if now < settings.game_starttime:
        wait_seconds = (settings.game_starttime - now).total_seconds()
        print(f"Waiting {wait_seconds} seconds until game start")
        time.sleep(wait_seconds + 1)

    while True:
        # wait for attackinfo to be available
        time.sleep(5)

        # fetch latest round(s)
        current_rounds = fetch_flagids(settings.scoreboard_attackinfo_url, settings.teamid, round=None)
        
        if len(current_rounds) == 0:
            # either before / after game, or sometimes between rounds
            print("No rounds available, waiting...")
            continue
        
        latest_round = max(r.round_id for r in current_rounds)
        print(f"Latest round is {latest_round}")
        
        ingest_flagids(current_rounds, cache, db=db)

        missing_rounds = get_missing_rounds(latest_round, cache.successfully_fetched_rounds)
        print(f"{len(missing_rounds)} missing rounds to backfill: {missing_rounds}")
        
        for round in missing_rounds[:40]: # limit fetching to 40 rounds at a time (so latest flagids are always fetched quickly)
            print(f"Fetching missing round {round}")
            round_flagids = fetch_flagids(settings.scoreboard_attackinfo_url, settings.teamid, round=round)

            if len(round_flagids) == 0:
                # print(f"Round {round} has no flagids (service down?), skipping")
                continue
            
            ingest_flagids(round_flagids, cache, db=db)
            
            # be nice to the scoreboard
            time.sleep(1)
        save_cache(settings.cache_path, cache)

        # sleep until next round
        next_round_time = round_to_time(settings.game_starttime, settings.game_round_duration, latest_round + 1)
        now = datetime.datetime.now(tz=settings.game_starttime.tzinfo)
        if next_round_time > now:
            wait_seconds = (next_round_time - now).total_seconds()
            print(f"Waiting {wait_seconds} seconds until next round {latest_round + 1} at {next_round_time.isoformat()}")
            time.sleep(wait_seconds)

