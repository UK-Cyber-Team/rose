#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# This file is part of Flower.
#
# Copyright ©2018 Nicolò Mazzucato
# Copyright ©2018 Antonio Groza
# Copyright ©2018 Brunello Simone
# Copyright ©2018 Alessio Marotta
# DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
#
# Flower is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# Flower is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with Flower.  If not, see <https://www.gnu.org/licenses/>.

import dataclasses
import os
import re
import traceback
import uuid
from flask import Flask, Response, send_file, session, jsonify
from flask_session import Session
from requests import get
import dateutil.parser
from ipaddress import ip_network
from functools import wraps

from configurations import (
    services,
    traffic_dir,
    start_date,
    tick_length,
    visualizer_url,
    flag_lifetime,
    flag_regex,
    dump_pcaps_dir,
    auth_password,
)
from pathlib import Path
from data2req import convert_flow_to_http_requests, convert_single_http_requests
from flask_cors import CORS
from flask import request

from flow2pwn import flow2pwn
import database, json_util

import nilsimsa

application = Flask(__name__)
application.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
application.config['SESSION_TYPE'] = 'filesystem'
application.config['SESSION_FILE_DIR'] = '/tmp/flask_sessions'
application.config['SESSION_PERMANENT'] = False
application.config['SESSION_USE_SIGNER'] = True
Session(application)
CORS(application, supports_credentials=True)
db = database.Pool(os.environ["TIMESCALE"])


def return_json_response(object, **kwargs):
    return Response(json_util.dumps(object), mimetype="application/json", **kwargs)


def return_text_response(object, **kwargs):
    return Response(object, mimetype="text/plain", **kwargs)


def requires_auth(f):
    """Decorator to require authentication for API endpoints"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # If no password is configured, allow access
        if not auth_password:
            return f(*args, **kwargs)
        
        # Check if user is authenticated
        if not session.get('authenticated'):
            return jsonify({'error': 'Authentication required'}), 401
        
        return f(*args, **kwargs)
    return decorated_function


def is_authenticated():
    """Check if user is authenticated"""
    if not auth_password:
        return True
    return session.get('authenticated', False)


@application.route("/")
def hello_world():
    return "Hello, World!"


@application.route("/auth/status")
def auth_status():
    """Check authentication status"""
    return return_json_response({
        'authenticated': is_authenticated(),
        'auth_required': bool(auth_password)
    })


@application.route("/auth/login", methods=['POST'])
def login():
    """Login endpoint"""
    if not auth_password:
        return return_json_response({'error': 'Authentication not configured'}), 400
    
    if not request.is_json:
        return return_json_response({'error': 'Content-Type must be application/json'}), 400
    
    data = request.get_json()
    if not data or 'password' not in data:
        return return_json_response({'error': 'Password required'}), 400
    
    if data['password'] == auth_password:
        session['authenticated'] = True
        return return_json_response({'success': True, 'authenticated': True})
    else:
        return return_json_response({'error': 'Invalid password'}), 401


@application.route("/auth/logout", methods=['POST'])
def logout():
    """Logout endpoint"""
    session.pop('authenticated', None)
    return return_json_response({'success': True, 'authenticated': False})


@application.route("/tick_info")
@requires_auth
def getTickInfo():
    data = {
        "startDate": start_date,
        "tickLength": tick_length,
        "flagLifetime": flag_lifetime,
    }
    return return_json_response(data)


@application.route("/query", methods=["POST"])
@requires_auth
def query():
    param = request.get_json()

    try:
        query = database.FlowQuery(
            regex_insensitive=(
                re.compile(param["regex_insensitive"])
                if "regex_insensitive" in param
                else None
            ),
            ip_src=ip_network(param["ip_src"]) if "ip_src" in param else None,
            ip_dst=ip_network(param["ip_dst"]) if "ip_dst" in param else None,
            port_src=param.get("port_src"),
            port_dst=param.get("port_dst"),
            time_from=(
                dateutil.parser.parse(param["time_from"])
                if "time_from" in param
                else None
            ),
            time_to=(
                dateutil.parser.parse(param["time_to"]) if "time_to" in param else None
            ),
            tags_include=[str(elem) for elem in param.get("tags_include", [])],
            tags_exclude=[str(elem) for elem in param.get("tags_exclude", [])],
            tag_intersection_and=param.get("tag_intersection_mode", "").lower() == "and",
        )
    except re.error as error:
        return return_json_response(
            {
                "error": str(error),
            },
            status=400,
        )

    with db.connection() as c:
        flows = c.flow_query(query)
    results = list(map(dataclasses.asdict, flows))

    similarity = int(param.get("similarity", 90))
    if len(param.get("includeFuzzyHashes", [])) > 0:
        results = [x for x in results if all(nilsimsa.compare_digests(hash, x["fuzzy_hash"]) >= similarity for hash in param["includeFuzzyHashes"])]
        for x in results:
            x["similarity"] = ((sum(nilsimsa.compare_digests(hash, x["fuzzy_hash"]) for hash in param["includeFuzzyHashes"]) / len(param["includeFuzzyHashes"])) + 128) / 256

    if len(param.get("excludeFuzzyHashes", [])) > 0:
        results = [x for x in results if all(nilsimsa.compare_digests(hash, x["fuzzy_hash"]) < similarity for hash in param["excludeFuzzyHashes"])]
        for x in results:
            similarity = ((-sum(nilsimsa.compare_digests(hash, x["fuzzy_hash"]) for hash in param["excludeFuzzyHashes"]) / len(param["excludeFuzzyHashes"]))+128)/256
            x["similarity"] = (similarity + x["similarity"])/2 if "similarity" in x else similarity

    return return_json_response(results)


@application.route("/stats")
@requires_auth
def getStats():
    query = request.args

    query = database.StatsQuery(
        service=query.get("service"),
        tick_from=int(query["tick_from"]) if "tick_from" in query else None,
        tick_to=int(query["tick_to"]) if "tick_to" in query else None,
    )

    with db.connection() as c:
        stats = c.stats_query(query)
    stats = list(stats.values())
    return return_json_response(stats)


@application.route("/under_attack")
@requires_auth
def getUnderAttack():
    res = get(
        f"{visualizer_url}/api/under-attack",
        params={
            "from_tick": request.args.get("from_tick"),
            "to_tick": request.args.get("to_tick"),
        },
    )
    assert res.status_code == 200

    tick_data = res.json()
    return return_json_response(tick_data)


@application.route("/tags")
@requires_auth
def getTags():
    with db.connection() as c:
        tags = c.tag_list()
    return return_json_response(tags)


@application.route("/tags", methods=["POST"])
@requires_auth
def createTag():
    """Create a new custom tag"""
    query = request.get_json()
    tag_name = query.get("name", "").strip()
    
    if not tag_name:
        return return_json_response(
            {"error": "Tag name is required"},
            status=400
        )
    
    # Validate tag name (alphanumeric, hyphens, underscores only)
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', tag_name):
        return return_json_response(
            {"error": "Tag name must contain only letters, numbers, hyphens, and underscores"},
            status=400
        )
    
    with db.connection() as c:
        created = c.tag_create(tag_name)
    
    if created:
        return return_json_response({"success": True, "tag": tag_name})
    else:
        return return_json_response(
            {"error": "Tag already exists"},
            status=409
        )


@application.route("/flow/<id>/tag", methods=["POST"])
@requires_auth
def addTagToFlow(id):
    """Add or remove a tag from a flow"""
    flow_id = uuid.UUID(id)
    query = request.get_json()
    tag_name = query.get("tag", "").strip()
    apply = bool(query.get("apply", True))
    
    if not tag_name:
        return return_json_response(
            {"error": "Tag name is required"},
            status=400
        )
    
    with db.connection() as c:
        c.flow_tag(flow_id, tag_name, apply)
    
    return return_json_response({"success": True, "flow_id": str(flow_id), "tag": tag_name, "applied": apply})


@application.route("/star", methods=["POST"])
@requires_auth
def setStar():
    query = request.get_json()
    flow_id = uuid.UUID(query.get("id"))
    apply = bool(query.get("star"))
    with db.connection() as c:
        c.flow_tag(flow_id, "starred", apply)
    return "ok!"


@application.route("/services")
@requires_auth
def getServices():
    return return_json_response(services)


@application.route("/flag_regex")
@requires_auth
def getFlagRegex():
    return return_json_response(flag_regex)


@application.route("/flow/<id>")
@requires_auth
def getFlowDetail(id):
    id = uuid.UUID(id)
    with db.connection() as c:
        flow = c.flow_detail(id)
    return return_json_response(flow)


@application.route("/flow/<id>/pcap")
@requires_auth
def getFlowPcap(id):
    """Generate and download a PCAP file for a specific flow"""
    import tempfile
    from scapy.all import Ether, IP, IPv6, TCP, UDP, wrpcap
    from scapy.packet import Raw
    
    flow_id = uuid.UUID(id)
    
    try:
        with db.connection() as c:
            flow = c.flow_detail(flow_id)
        
        if not flow:
            return return_json_response({"error": "Flow not found"}, status=404)
        
        packets = []
        
        # Get raw flow items (actual packet data)
        raw_items = flow.kind_items("raw")
        
        if not raw_items:
            return return_json_response({"error": "No packet data available for this flow"}, status=404)
        
        # Determine if IPv4 or IPv6
        is_ipv6 = ":" in str(flow.ip_src)
        
        for item in raw_items:
            try:
                # Create IP layer
                if is_ipv6:
                    ip_layer = IPv6(src=str(flow.ip_src), dst=str(flow.ip_dst))
                else:
                    ip_layer = IP(src=str(flow.ip_src), dst=str(flow.ip_dst))
                
                # Determine direction and set ports accordingly
                if item.direction == "out":
                    sport = flow.port_src
                    dport = flow.port_dst
                else:
                    sport = flow.port_dst
                    dport = flow.port_src
                
                # Create transport layer (TCP or UDP based on tags)
                if "tcp" in flow.tags:
                    transport_layer = TCP(sport=sport, dport=dport)
                elif "udp" in flow.tags:
                    transport_layer = UDP(sport=sport, dport=dport)
                else:
                    # Default to TCP if no tag specified
                    transport_layer = TCP(sport=sport, dport=dport)
                
                # Build the packet
                packet = Ether() / ip_layer / transport_layer / Raw(load=item.data)
                
                # Set timestamp
                packet.time = item.time.timestamp()
                
                packets.append(packet)
                
            except Exception as e:
                # Log error but continue processing other packets
                print(f"Error creating packet: {e}")
                continue
        
        if not packets:
            return return_json_response({"error": "Failed to generate any packets"}, status=500)
        
        # Write packets to temporary file
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.pcap', delete=False) as tmp_file:
            tmp_path = tmp_file.name
            wrpcap(tmp_path, packets)
        
        # Generate filename
        filename = f"tulip_flow_{flow_id}.pcap"
        
        # Send file and clean up
        response = send_file(
            tmp_path,
            mimetype="application/vnd.tcpdump.pcap",
            as_attachment=True,
            download_name=filename
        )
        
        # Schedule file deletion after sending
        @response.call_on_close
        def cleanup():
            try:
                os.unlink(tmp_path)
            except:
                pass
        
        return response
        
    except Exception as e:
        traceback.print_exc()
        return return_json_response(
            {"error": f"Failed to generate PCAP: {str(e)}"},
            status=500
        )

@application.route("/to_single_python_request", methods=["POST"])
@requires_auth
def convertToSingleRequest():
    flow_id = request.args.get("id", "")
    item_index = request.args.get("index", "")

    if flow_id == "":
        return return_text_response(
            "There was an error while converting the request:\n{}: {}".format(
                "No flow id", "No flow id param"
            )
        )
    if item_index == "":
        return return_text_response(
            "There was an error while converting the request:\n{}: {}".format(
                "No index", "No item index param"
            )
        )

    flow_id = uuid.UUID(flow_id)
    item_index = int(item_index)
    with db.connection() as c:
        flow = c.flow_detail(flow_id)
    if not flow:
        return return_text_response(
            "There was an error while converting the request:\n{}: {}".format(
                "Invalid flow", "Invalid flow id"
            )
        )
    if item_index >= len(flow.items):
        return return_text_response(
            "There was an error while converting the request:\n{}: {}".format(
                "Invalid index", "Index out of range"
            )
        )

    tokenize = bool(request.args.get("tokenize", False))
    use_requests_session = bool(request.args.get("use_requests_session", False))
    try:
        converted = convert_single_http_requests(
            flow, item_index, tokenize, use_requests_session
        )
    except Exception as ex:
        return return_text_response(
            "There was an error while converting the request:\n{}: {}".format(
                type(ex).__name__, traceback.format_exc()
            )
        )
    return return_text_response(converted)


@application.route("/to_python_request/<id>")
@requires_auth
def convertToRequests(id):
    id = uuid.UUID(id)
    with db.connection() as c:
        flow = c.flow_detail(id)
    if not flow:
        return return_text_response(
            "There was an error while converting the request:\n{}: {}".format(
                "Invalid flow", "Invalid flow id"
            )
        )
    tokenize = bool(request.args.get("tokenize", True))
    use_requests_session = bool(request.args.get("use_requests_session", True))
    try:
        converted = convert_flow_to_http_requests(flow, tokenize, use_requests_session)
    except Exception as ex:
        return return_text_response(
            "There was an error while converting the request:\n{}: {}".format(
                type(ex).__name__, traceback.format_exc()
            )
        )
    return return_text_response(converted)


@application.route("/to_pwn/<id>")
@requires_auth
def confertToPwn(id):
    id = uuid.UUID(id)
    with db.connection() as c:
        flow = c.flow_detail(id)
    if not flow:
        return return_text_response(
            "There was an error while converting the request:\n{}: {}".format(
                "Invalid flow", "Invalid flow id"
            )
        )
    return return_text_response(flow2pwn(flow))


@application.route("/download/")
@requires_auth
def downloadFile():
    filepath = request.args.get("file")
    if filepath is None:
        return return_text_response(
            "There was an error while downloading the requested file:\n{}: {}".format(
                "Invalid 'file'", "No 'file' given"
            )
        )
    filepath = Path(filepath)

    # Check for path traversal by resolving the file first.
    filepath = filepath.resolve()
    if traffic_dir not in filepath.parents and dump_pcaps_dir not in filepath.parents:
        return return_text_response(
            "There was an error while downloading the requested file:\n{}: {}".format(
                "Invalid 'file'",
                "'file' was not in a subdirectory of traffic_dir or dump_pcaps_dir",
            )
        )

    try:
        return send_file(filepath, as_attachment=True)
    except FileNotFoundError:
        return return_text_response(
            "There was an error while downloading the requested file:\n{}: {}".format(
                "Invalid 'file'", "'file' not found"
            )
        )


if __name__ == "__main__":
    try:
        db.open()
        application.run(host="0.0.0.0", threaded=True)
    finally:
        db.close()
