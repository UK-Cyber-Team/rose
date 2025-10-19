import { format, parse } from "date-fns";
import { Suspense, useState } from "react";
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Link,
  useParams,
  useSearchParams,
  useNavigate,
} from "react-router-dom";
import ReactDiffViewer from "react-diff-viewer";

import {
  END_FILTER_KEY,
  SERVICE_FILTER_KEY,
  START_FILTER_KEY,
  TEXT_FILTER_KEY,
  FIRST_DIFF_KEY,
  SECOND_DIFF_KEY,
  SERVICE_REFETCH_INTERVAL_MS,
  REPR_ID_KEY,
  SIMILARITY_FILTER_KEY,
} from "../const";
import {
  useGetFlowQuery,
  useGetServicesQuery,
  useLogoutMutation,
  useCheckAuthStatusQuery,
  useLazyGetRandomFlowQuery,
} from "../api";
import { useAppSelector, useAppDispatch } from "../store";
import { logout } from "../store/auth";
import { getTickStuff } from "../tick";
import { DarkModeToggle } from "./DarkModeToggle";

function ConfigButton() {
  const { data: authStatus } = useCheckAuthStatusQuery();
  const navigate = useNavigate();
  let [searchParams] = useSearchParams();

  // Only show config button if user is authenticated
  if (authStatus?.auth_required && !authStatus?.authenticated) {
    return null;
  }

  return (
    <button 
      onClick={() => navigate(`/config?${searchParams}`)}
      className="bg-purple-100 hover:bg-purple-200 dark:bg-purple-700 dark:hover:bg-purple-600 text-purple-800 dark:text-purple-100 rounded-md px-2 py-1 text-sm whitespace-nowrap"
    >
      Config
    </button>
  );
}

function LogoutButton() {
  const dispatch = useAppDispatch();
  const { authRequired } = useAppSelector((state) => state.auth);
  const [logoutMutation] = useLogoutMutation();

  const handleLogout = async () => {
    try {
      await logoutMutation().unwrap();
      dispatch(logout());
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Only show logout button if authentication is required
  if (!authRequired) {
    return null;
  }

  return (
    <button
      onClick={handleLogout}
      className="bg-red-100 hover:bg-red-200 dark:bg-red-800 dark:hover:bg-red-700 text-red-800 dark:text-red-100 rounded-md px-2 py-1 text-sm whitespace-nowrap"
    >
      Logout
    </button>
  );
}

function ServiceSelection() {
  const FILTER_KEY = SERVICE_FILTER_KEY;

  // TODO add all, maybe user react-select

  const { data: services } = useGetServicesQuery(undefined, {
    pollingInterval: SERVICE_REFETCH_INTERVAL_MS,
  });

  const service_select = [
    {
      ip: "",
      port: 0,
      name: "all",
    },
    ...(services || []),
  ];
  let [searchParams, setSearchParams] = useSearchParams();
  return (
    <select
      className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
      value={searchParams.get(FILTER_KEY) ?? ""}
      onChange={(event) => {
        let serviceFilter = event.target.value;
        if (serviceFilter && serviceFilter != "all") {
          searchParams.set(FILTER_KEY, serviceFilter);
        } else {
          searchParams.delete(FILTER_KEY);
        }
        setSearchParams(searchParams);
      }}
    >
      {service_select.map((service) => (
        <option key={service.name} value={service.name} className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          {service.name}
        </option>
      ))}
    </select>
  );
}

function TextSearch() {
  const FILTER_KEY = TEXT_FILTER_KEY;
  let [searchParams, setSearchParams] = useSearchParams();
  useHotkeys('s', (e) => {
    let el = document.getElementById('search') as HTMLInputElement;
    el?.focus();
    el?.select();
    e.preventDefault()
  });
  return (
    <div>
      <input
        type="text"
        placeholder="regex"
        id="search"
        className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        value={searchParams.get(FILTER_KEY) || ""}
        onChange={(event) => {
          let textFilter = event.target.value;
          if (textFilter) {
            searchParams.set(FILTER_KEY, textFilter);
          } else {
            searchParams.delete(FILTER_KEY);
          }
          setSearchParams(searchParams);
        }}
      ></input>
    </div>
  );
}


function StartDateSelection() {
  let { startTickParam, setTimeParam } = getTickStuff();
  return (
    <div>
      <input
        className="w-20 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        id="startdateselection"
        type="number"
        placeholder="from"
        value={startTickParam}
        onChange={(event) => {
          setTimeParam(event.target.value == "" ? null : parseInt(event.target.value), START_FILTER_KEY);
        }}
      ></input>
    </div>
  );
}

function EndDateSelection() {
  let { endTickParam, setTimeParam } = getTickStuff();
  return (
    <div>
      <input
        className="w-20 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        id="enddateselection"
        type="number"
        placeholder="to"
        value={endTickParam}
        onChange={(event) => {
          setTimeParam(event.target.value == "" ? null : parseInt(event.target.value), END_FILTER_KEY);
        }}
      ></input>
    </div>
  );
}

function FirstDiff() {
  let params = useParams();
  let [searchParams, setSearchParams] = useSearchParams();
  const [firstFlow, setFirstFlow] = useState<string>(
    searchParams.get(FIRST_DIFF_KEY) ?? ""
  );

  function setFirstDiffFlow() {
    let textFilter = params.id;
    let reprId = searchParams.get(REPR_ID_KEY);
    let reprIdSlug = reprId ? `${textFilter}:${reprId}` : `${textFilter}`
    if (textFilter) {
      searchParams.set(FIRST_DIFF_KEY, reprIdSlug);
      setFirstFlow(reprIdSlug);
    } else {
      searchParams.delete(FIRST_DIFF_KEY);
      setFirstFlow("");
    }
    setSearchParams(searchParams);
  }

  useHotkeys("f", () => {
    setFirstDiffFlow();
  });

  return (
    <input
      type="text"
      className="w-48 xl:w-72 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-sm"
      placeholder="First Diff ID"
      readOnly
      value={firstFlow}
      onClick={(event) => setFirstDiffFlow()}
      onContextMenu={(event) => {
        searchParams.delete(FIRST_DIFF_KEY);
        setFirstFlow("");
        setSearchParams(searchParams);
        event.preventDefault();
      }}
    ></input>
  );
}

function SecondDiff() {
  let params = useParams();
  let [searchParams, setSearchParams] = useSearchParams();
  const [secondFlow, setSecondFlow] = useState<string>(
    searchParams.get(SECOND_DIFF_KEY) ?? ""
  );

  function setSecondDiffFlow() {
    let textFilter = params.id;
    let reprId = searchParams.get(REPR_ID_KEY);
    let reprIdSlug = reprId ? `${textFilter}:${reprId}` : `${textFilter}`
    if (textFilter) {
      searchParams.set(SECOND_DIFF_KEY, reprIdSlug);
      setSecondFlow(reprIdSlug);
    } else {
      searchParams.delete(SECOND_DIFF_KEY);
      setSecondFlow("");
    }
    setSearchParams(searchParams);
  }

  useHotkeys("g", () => {
    setSecondDiffFlow();
  });

  return (
    <input
      type="text"
      className="w-48 xl:w-72 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-sm"
      placeholder="Second Flow ID"
      readOnly
      value={secondFlow}
      onClick={(event) => setSecondDiffFlow()}
      onContextMenu={(event) => {
        searchParams.delete(SECOND_DIFF_KEY);
        setSecondFlow("");
        setSearchParams(searchParams);
        event.preventDefault();
      }}
    ></input>
  );
}

function Diff() {
  let params = useParams();

  let [searchParams] = useSearchParams();

  let navigate = useNavigate();

  function navigateToDiff() {
    navigate(`/diff/${params.id ?? ""}?${searchParams}`, { replace: true });
  }

  useHotkeys("d", () => {
    navigateToDiff();
  });

  return (
    <button
      className="bg-amber-100 hover:bg-amber-200 dark:bg-amber-700 dark:hover:bg-amber-600 text-gray-800 dark:text-amber-100 rounded-md px-2 py-1 text-sm whitespace-nowrap"
      onClick={() => {
        navigateToDiff()
      }}
    >
      Diff
    </button>
  );
}

function SimilaritySlider() {
  let [searchParams, setSearchParams] = useSearchParams();
  const [value, setValue] = useState(searchParams.get(SIMILARITY_FILTER_KEY) ?? 90);

  const handleChange = (event:any) => {
    setValue(event.target.value);
    searchParams.set(SIMILARITY_FILTER_KEY, event.target.value);
    setSearchParams(searchParams);
  }

  return (

    <div className="flex items-center">
      <div className="pr-3">
        <span>
	  Similarity:
	</span>
	<input
	  style={{paddingTop:0, paddingBottom: 0}}
	  type="range"
	  min="0"
	  max="100"
	  value={value}
	  onChange={handleChange}
	/>
      </div>
      <input
        className="w-20"
	type="number"
	min="0"
	max="100"
	value={value}
	onChange={handleChange}
      />
    </div>
  );
}

function NoveltyModeToggle({ isNoveltyMode, setIsNoveltyMode }: { isNoveltyMode: boolean; setIsNoveltyMode: (value: boolean) => void }) {
  return (
    <button
      onClick={() => setIsNoveltyMode(!isNoveltyMode)}
      className="text-2xl md:text-3xl hover:scale-110 transition-transform flex-shrink-0"
      title={isNoveltyMode ? "Novelty Mode (Click for Business Mode)" : "Business Mode (Click for Novelty Mode)"}
    >
      {isNoveltyMode ? "🤡" : "💼"}
    </button>
  );
}

function FeelingLuckyButton({ isNoveltyMode }: { isNoveltyMode: boolean }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [triggerRandom, { isLoading }] = useLazyGetRandomFlowQuery();

  const handleClick = async () => {
    try {
      const result = await triggerRandom().unwrap();
      if (result?.id) {
        navigate(`/flow/${result.id}?${searchParams}`);
      }
    } catch (error) {
      console.error('Failed to get random flow:', error);
    }
  };

  if (!isNoveltyMode) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold rounded-md px-2 md:px-3 py-1 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
    >
      {isLoading ? "🎲 Loading..." : "🎲 I'm feeling lucky"}
    </button>
  );
}

export function Header() {
  let { currentTick, setToLastnTicks, setTimeParam } = getTickStuff();
  let [searchParams] = useSearchParams();
  const [isNoveltyMode, setIsNoveltyMode] = useState(false);

  useHotkeys('a', () => setToLastnTicks(5));
  useHotkeys('c', () => {
    (document.getElementById("startdateselection") as HTMLInputElement).value = "";
    (document.getElementById("enddateselection") as HTMLInputElement).value = "";
    setTimeParam(null, START_FILTER_KEY);
    setTimeParam(null, END_FILTER_KEY);
  });

  return (
    <>
      <Link to={`/?${searchParams}`} className="flex-shrink-0">
        <div className="header-icon">🥀</div>
      </Link>
      <div className="flex-shrink-0">
        <TextSearch></TextSearch>
      </div>
      <div className="flex-shrink-0">
        <Suspense>
          <ServiceSelection></ServiceSelection>
        </Suspense>
      </div>
      <Link to={`/corrie?${searchParams}`} className="flex-shrink-0">
        <div className="bg-blue-100 hover:bg-blue-200 dark:bg-blue-700 dark:hover:bg-blue-600 text-gray-800 dark:text-blue-100 rounded-md px-2 py-1 text-sm whitespace-nowrap">
          Graph view
        </div>
      </Link>
      <div className="hidden lg:block flex-shrink-0">
        <SimilaritySlider></SimilaritySlider>
      </div>
      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        <div className="hidden xl:flex gap-2">
          <FirstDiff />
          <SecondDiff />
          <Suspense>
            <Diff />
          </Suspense>
        </div>
        <div className="hidden md:block text-sm whitespace-nowrap">
          Current: {currentTick}
        </div>
        <NoveltyModeToggle isNoveltyMode={isNoveltyMode} setIsNoveltyMode={setIsNoveltyMode} />
        {isNoveltyMode && <FeelingLuckyButton isNoveltyMode={isNoveltyMode} />}
        <DarkModeToggle />
        <ConfigButton />
        <LogoutButton />
      </div>
    </>
  );
}
