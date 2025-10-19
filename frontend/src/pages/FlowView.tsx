import { useSearchParams, Link, useParams, useNavigate } from "react-router-dom";
import React, { ChangeEvent, useDeferredValue, useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { FlowData, FullFlow } from "../types";
import { Buffer } from "buffer";
import {
  TEXT_FILTER_KEY,
  MAX_LENGTH_FOR_HIGHLIGHT,
  API_BASE_PATH,
  REPR_ID_KEY,
  FIRST_DIFF_KEY,
  SECOND_DIFF_KEY,
} from "../const";
import {
  ArrowCircleLeftIcon,
  ArrowCircleRightIcon,
  ArrowCircleUpIcon,
  ArrowCircleDownIcon,
  DownloadIcon,
  LightningBoltIcon,
} from "@heroicons/react/solid";
import { format } from "date-fns";

import { hexy } from "hexy";
import { useCopy } from "../hooks/useCopy";
import { RadioGroup } from "../components/RadioGroup";
import {
  useGetFlowQuery,
  useGetServicesQuery,
  useLazyToFullPythonRequestQuery,
  useLazyToPwnToolsQuery,
  useToSinglePythonRequestQuery,
  useGetFlagRegexQuery,
  useGetTagsQuery,
  useCreateTagMutation,
  useAddTagToFlowMutation,
} from "../api";
import { getTickStuff } from "../tick";
import { toggleFilterFuzzyHashes, toggleFilterTag } from "../store/filter";
import { useAppDispatch, useAppSelector } from "../store";
import escapeStringRegexp from "escape-string-regexp";

const SECONDARY_NAVBAR_HEIGHT = 50;

function CopyButton({ copyText }: { copyText?: string }) {
  const { statusText, copy, copyState } = useCopy({
    getText: async () => copyText ?? "",
  });
  return (
    <>
      {copyText && (
        <button
          className="p-2 text-sm text-blue-500 dark:text-blue-300 disabled:text-blue-300/60 dark:disabled:text-blue-200/50 transition-colors duration-150"
          onClick={copy}
          disabled={!copyText}
        >
          {statusText}
        </button>
      )}
    </>
  );
}

function FlowContainer({
  copyText,
  children,
}: {
  copyText?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-5 flex flex-col gap-2">
      <div className="ml-auto">
        <CopyButton copyText={copyText}></CopyButton>
      </div>
      <pre className="p-5 overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-inner transition-colors duration-150">
        {children}
      </pre>
    </div>
  );
}

function HexFlow({ flow }: { flow: FlowData }) {
  const hex = hexy(Buffer.from(flow.b64, "base64"), { format: "twos" });
  return <FlowContainer copyText={hex}>{hex}</FlowContainer>;
}
function highlightText(flowText: string, search_string: string, flag_string: string) {
  if (flowText.length > MAX_LENGTH_FOR_HIGHLIGHT || (flag_string === "" && search_string === "")) {
    return flowText
  }
  try {
    const searchClasses = "bg-orange-200 dark:bg-orange-700 text-black dark:text-white rounded-sm";
    const flagClasses = "bg-red-200 dark:bg-red-700 text-black dark:text-white rounded-sm";

    // Matches are stored as `[start index, end index]`.
    // For some reason tsc compiler (during build) thinks that `x.index` can be undefined (no, it can't).
    // I wasn't able to find a workaround for it so @ts-ignore it is...
    // Other way would be `x.index ?? 0` but that seems like it is doing something more than fixing typescript issues.
    // @ts-ignore
    const flagMatches: [number, number][] = (
      flag_string === ""
        ? []
        // @ts-ignore
        : [...flowText.matchAll(new RegExp(flag_string, "g"))].map(x => [x.index, x.index + x[0].length])
    );
    // @ts-ignore
    const searchMatches: [number, number][] = (
      search_string === ""
        ? []
        // @ts-ignore
        : [...flowText.matchAll(new RegExp(search_string, "gi"))].map(x => [x.index, x.index + x[0].length])
    );

    let parts = [];
    let currentIndex = 0, flagMatchIndex = 0, searchMatchIndex = 0;
    while (true) {
      // Pick next match
      let isSearchMatch = null;
      if (flagMatchIndex < flagMatches.length && searchMatchIndex < searchMatches.length) {
        isSearchMatch = searchMatches[searchMatchIndex][0] <= flagMatches[flagMatchIndex][0];
      } else if (searchMatchIndex < searchMatches.length) {
        isSearchMatch = true;
      } else if (flagMatchIndex < flagMatches.length) {
        isSearchMatch = false;
      }
      let match = (
        isSearchMatch === null
          ? null
          : isSearchMatch ? searchMatches[searchMatchIndex] : flagMatches[flagMatchIndex]
      );

      // Produce element for remaining text if there is no match
      if (match === null) {
        parts.push(<span key={currentIndex}>{flowText.slice(currentIndex)}</span>);
        break;
      }

      // Produce element for part between previous and next/current match
      if (currentIndex != match[0]) {
        parts.push(<span key={currentIndex}>{flowText.slice(currentIndex, match[0])}</span>);
      }

      // Produce element for current match
      parts.push(<span key={match[0]} className={isSearchMatch ? searchClasses : flagClasses}>{flowText.slice(match[0], match[1])}</span>);

      // Advance position to end of match
      currentIndex = match[1];

      // Advance "pointers" for flag matches
      while (flagMatchIndex < flagMatches.length && flagMatches[flagMatchIndex][1] <= currentIndex) flagMatchIndex++;
      // If current match ends in the middle of next match, we cut that overlaping part out
      if (flagMatchIndex < flagMatches.length && flagMatches[flagMatchIndex][0] < currentIndex) flagMatches[flagMatchIndex][0] = currentIndex;
      // Do the same also for search matches
      while (searchMatchIndex < searchMatches.length && searchMatches[searchMatchIndex][1] <= currentIndex) searchMatchIndex++;
      if (searchMatchIndex < searchMatches.length && searchMatches[searchMatchIndex][0] < currentIndex) searchMatches[searchMatchIndex][0] = currentIndex;
    }

    return <span>{parts}</span>;
  } catch (error) {
    console.log(error);
    return flowText;
  }
}

function TextFlow({ flow }: { flow: FlowData }) {
  let [searchParams] = useSearchParams();
  const text_filter = searchParams.get(TEXT_FILTER_KEY);
  const { data: flag_regex } = useGetFlagRegexQuery();
  const text = highlightText(flow.data, text_filter ?? "", flag_regex ?? "");

  return <FlowContainer copyText={flow.data}>{text}</FlowContainer>;
}

function WebFlow({ flow }: { flow: FlowData }) {
  const data = flow.data;
  const [header, ...rest] = data.split("\r\n\r\n");
  const http_content = rest.join("\r\n\r\n");

  const Hack = "iframe" as any;
  return (
    <FlowContainer>
      <pre>{header}</pre>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
        <Hack
          srcDoc={http_content}
          sandbox=""
          height={300}
          csp="default-src none" // there is a warning here but it actually works, not supported in firefox though :(
        ></Hack>
      </div>
    </FlowContainer>
  );
}

function PythonRequestFlow({
  full_flow,
  flow,
  item_index,
}: {
  full_flow: FullFlow;
  flow: FlowData;
  item_index: number,
}) {
  const { data } = useToSinglePythonRequestQuery({
    body: flow.b64,
    id: full_flow.id,
    item_index,
    tokenize: true,
  });

  return <FlowContainer copyText={data}>{data}</FlowContainer>;
}

interface FlowProps {
  full_flow: FullFlow;
  flow: FlowData;
  flow_item_index: number;
  delta_time: number;
  id: string;
}

function detectType(flow: FlowData) {
  const firstLine = flow.data.split("\n")[0];
  if (firstLine.includes("HTTP")) {
    return "Web";
  }

  return "Plain";
}

function getFlowBody(flow: FlowData, flowType: string) {
  if (flowType == "Web") {
    const contentType = flow.data.match(/Content-Type: ([^\s;]+)/im)?.[1];
    if (contentType) {
      const body = Buffer.from(flow.b64, "base64").subarray(flow.data.indexOf("\r\n\r\n") + 4);
      return [contentType, body]
    }
  }
  return null
}

function Flow({ full_flow, flow, flow_item_index, delta_time, id }: FlowProps) {
  const formatted_time = format(new Date(flow.time), "HH:mm:ss:SSS");
  const displayOptions = flow.from === "s"
    ? ["Plain", "Hex", "Web"]
    : ["Plain", "Hex", "PythonRequest"];

  // Basic type detection, currently unused
  const [displayOption, setDisplayOption] = useState("Plain");

  const flowType = detectType(flow);
  const flowBody = getFlowBody(flow, flowType);

  return (
    <div className="text-mono" id={id}>
      <div
        className="sticky shadow-md bg-white dark:bg-blue-900 overflow-auto py-1 border-y border-gray-200 dark:border-gray-700"
        style={{ top: SECONDARY_NAVBAR_HEIGHT }}
      >
        <div className="flex items-center h-6">
          <div className="w-8 px-2">
            {flow.from === "s" ? (
              <ArrowCircleLeftIcon className="fill-green-700 dark:fill-green-400 transition-colors duration-150" />
            ) : (
              <ArrowCircleRightIcon className="fill-red-700 dark:fill-red-400 transition-colors duration-150" />
            )}
          </div>
          <div style={{ width: 200 }} className="text-black dark:text-white">
            {formatted_time}
            <span className="text-gray-400 dark:text-gray-500 pl-3">{delta_time}ms</span>
          </div>
          <button
            className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 py-1 px-2 rounded-md text-xs md:text-sm whitespace-nowrap"
            onClick={async () => {
              window.open(
                "https://gchq.github.io/CyberChef/#input=" +
                encodeURIComponent(flow.b64)
              );
            }}
          >
            Open in CC
          </button>
          {flowType == "Web" && flowBody && (
            <button
              className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 py-1 px-2 rounded-md text-xs md:text-sm ml-2 whitespace-nowrap"
              onClick={async () => {
                window.open(
                  "https://gchq.github.io/CyberChef/#input=" +
                  encodeURIComponent(flowBody[1].toString("base64"))
                );
              }}
            >
              Open body in CC
            </button>
          )}
          <button
            className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 py-1 px-2 rounded-md text-sm ml-2"
            onClick={async () => {
              const blob = new Blob([Buffer.from(flow.b64, "base64")], {
                type: "application/octet-stream",
              });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.style.display = "none";
              a.href = url;
              a.download = "tulip-dl-" + id + ".dat";
              document.body.appendChild(a);
              a.click();
              window.URL.revokeObjectURL(url);
              a.remove();
            }}
          >
            Download
          </button>
          {flowType == "Web" && flowBody && (
            <button
              className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 py-1 px-2 rounded-md text-sm ml-2"
              onClick={async () => {
                const blob = new Blob([flowBody[1]], {
                  type: flowBody[0].toString(),
                });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.style.display = "none";
                a.href = url;
                a.download = "tulip-dl-" + id + ".dat";
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
              }}
            >
              Download body
            </button>
          )}
          <RadioGroup
            options={displayOptions}
            value={displayOption}
            onChange={setDisplayOption}
            className="flex gap-2 text-gray-800 dark:text-gray-200 text-sm mr-4 ml-auto"
          />
        </div>
      </div>
      <div
        className={
          flow.from === "s"
            ? "border-l-8 border-green-300 dark:border-green-500"
            : "border-l-8 border-red-300 dark:border-red-500"
        }
      >
        {displayOption === "Hex" && <HexFlow flow={flow}></HexFlow>}
        {displayOption === "Plain" && <TextFlow flow={flow}></TextFlow>}
        {displayOption === "Web" && <WebFlow flow={flow}></WebFlow>}
        {displayOption === "PythonRequest" && (
          <PythonRequestFlow
            flow={flow}
            full_flow={full_flow}
            item_index={flow_item_index}
          ></PythonRequestFlow>
        )}
      </div>
    </div>
  );
}

// Helper function to format the IP for display. If the IP contains ":",
// assume it is an ipv6 address and surround it in square brackets
function formatIP(ip: string) {
  return ip.includes(":") ? `[${ip}]` : ip;
}

function FlowOverview({ flow }: { flow: FullFlow }) {
  let [searchParams, setSearchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const { unixTimeToTick } = getTickStuff();
  const { data: services } = useGetServicesQuery();
  const { data: availableTags } = useGetTagsQuery();
  const [createTag] = useCreateTagMutation();
  const [addTagToFlow] = useAddTagToFlowMutation();
  
  const [newTagName, setNewTagName] = useState("");
  const [selectedTagToAdd, setSelectedTagToAdd] = useState("");
  const [tagError, setTagError] = useState("");
  const [tagSuccess, setTagSuccess] = useState("");

  const handleCreateTag = async () => {
    setTagError("");
    setTagSuccess("");
    
    if (!newTagName.trim()) {
      setTagError("Tag name cannot be empty");
      return;
    }
    
    try {
      await createTag({ name: newTagName.trim() }).unwrap();
      setTagSuccess(`Tag "${newTagName}" created successfully`);
      setNewTagName("");
      setTimeout(() => setTagSuccess(""), 3000);
    } catch (error: any) {
      setTagError(error?.data?.error || "Failed to create tag");
    }
  };

  const handleAddTag = async () => {
    setTagError("");
    setTagSuccess("");
    
    if (!selectedTagToAdd) {
      setTagError("Please select a tag");
      return;
    }
    
    try {
      await addTagToFlow({ 
        flowId: flow.id, 
        tag: selectedTagToAdd, 
        apply: true 
      }).unwrap();
      setTagSuccess(`Tag "${selectedTagToAdd}" added to flow`);
      setSelectedTagToAdd("");
      setTimeout(() => setTagSuccess(""), 3000);
    } catch (error: any) {
      setTagError(error?.data?.error || "Failed to add tag");
    }
  };

  const handleRemoveTag = async (tag: string) => {
    try {
      await addTagToFlow({ 
        flowId: flow.id, 
        tag: tag, 
        apply: false 
      }).unwrap();
      setTagSuccess(`Tag "${tag}" removed from flow`);
      setTimeout(() => setTagSuccess(""), 3000);
    } catch (error: any) {
      setTagError(error?.data?.error || "Failed to remove tag");
    }
  };

  const service = services?.find((s) => s.ip === flow.dst_ip && s.port === flow.dst_port)?.name ?? "unknown";
  return (
    <div>
      {flow.signatures?.length > 0 ? (
        <div className="bg-blue-200 dark:bg-blue-800 p-2 text-black dark:text-white">
          <div className="font-extrabold text-black dark:text-white">Suricata</div>
          <div className="pl-2">
            {flow.signatures.map((sig) => {
              return (
                <div className="py-1">
                  <div className="flex">
                    <div className="text-black dark:text-white">Message:&nbsp;</div>
                    <div className="font-bold text-black dark:text-white">{sig.message}</div>
                  </div>
                  <div className="flex">
                    <div className="text-black dark:text-white">Rule ID:&nbsp;</div>
                    <div className="font-bold text-black dark:text-white">{sig.id}</div>
                  </div>
                  <div className="flex">
                    <div className="text-black dark:text-white">Action taken:&nbsp;</div>
                    <div
                      className={
                        sig.action === "blocked"
                          ? "font-bold text-red-800 dark:text-red-300"
                          : "font-bold text-green-800 dark:text-green-300"
                      }
                    >
                      {sig.action}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : undefined}
      <div className="bg-yellow-200 dark:bg-yellow-800 p-2 text-black dark:text-white">
        <div className="font-extrabold text-black dark:text-white">Meta</div>
        <div className="pl-2">
          <div className="text-black dark:text-white">
            Flow ID:&nbsp;
            <span className="font-mono font-bold text-black dark:text-white">{flow.id}</span>
          </div>
          <div className="text-black dark:text-white">
            Source:&nbsp;
            <a className="font-bold text-black dark:text-white hover:text-blue-600 dark:hover:text-blue-400" href={`${API_BASE_PATH}/download/?file=${flow.filename}`}>
              {flow.filename}
              <DownloadIcon className="inline-flex items-baseline w-5 h-5" />
            </a>
          </div>
          <div className="text-black dark:text-white">
            Tags:&nbsp;
            <span className="font-bold text-black dark:text-white">
              [{flow.tags.map((tag, i) => (
                <span key={tag}>
                  {i > 0 ? ", " : ""}
                  {tag}
                  {!["tcp", "udp", "http", "flag-in", "flag-out", "flagid-in", "flagid-out", "blocked", "suricata", "starred"].includes(tag) && (
                    <button
                      className="ml-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-xs"
                      onClick={() => handleRemoveTag(tag)}
                      title="Remove this tag"
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}]
            </span>
          </div>
          
          {/* Custom Tag Management */}
          <div className="mt-2 p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded border border-yellow-300 dark:border-yellow-700">
            <div className="text-sm font-semibold text-black dark:text-white mb-2">Tag Management</div>
            
            {/* Add existing tag to flow */}
            <div className="flex gap-2 mb-2">
              <select
                value={selectedTagToAdd}
                onChange={(e) => setSelectedTagToAdd(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-black dark:text-white"
              >
                <option value="">Select a tag to add...</option>
                {availableTags?.filter(t => !flow.tags.includes(t)).map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
              <button
                onClick={handleAddTag}
                disabled={!selectedTagToAdd}
                className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Tag
              </button>
            </div>
            
            {/* Create new tag */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleCreateTag()}
                placeholder="Create new tag..."
                className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-black dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              />
              <button
                onClick={handleCreateTag}
                disabled={!newTagName.trim()}
                className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
            
            {/* Status messages */}
            {tagError && (
              <div className="mt-2 text-sm text-red-600 dark:text-red-400">{tagError}</div>
            )}
            {tagSuccess && (
              <div className="mt-2 text-sm text-green-600 dark:text-green-400">{tagSuccess}</div>
            )}
          </div>
          
          <div className="text-black dark:text-white">
            Tick:&nbsp;
            <span className="font-bold text-black dark:text-white">{unixTimeToTick(flow.time)}</span>
          </div>
          <div className="text-black dark:text-white">
            Service:&nbsp;
            <span className="font-bold text-black dark:text-white">{service}</span>
          </div>
          <div className="text-black dark:text-white">
            Flags:&nbsp;
            <span className="font-bold text-black dark:text-white">
              [{flow.flags.map((query, i) => (
                <span>
                  {i > 0 ? ", " : ""}
                  <button className="font-bold text-black dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                    onClick={() => {
                      searchParams.set(TEXT_FILTER_KEY, escapeStringRegexp(query));
                      setSearchParams(searchParams);
                    }}
                  >
                    {query}
                  </button>
                </span>
              ))}]
            </span>
          </div>
          <div className="text-black dark:text-white">
            Flagids:&nbsp;
            <span className="font-bold text-black dark:text-white">
              [{flow.flagids.map((query, i) => (
                <span>
                  {i > 0 ? ", " : ""}
                  <button className="font-bold text-black dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                    onClick={() => {
                      searchParams.set(TEXT_FILTER_KEY, escapeStringRegexp(query));
                      setSearchParams(searchParams);
                    }}
                  >
                    {query}
                  </button>
                </span>
              ))}]
            </span>
          </div>
          <div className="text-black dark:text-white">
            Nilsimsa hash:&nbsp;
            <div className="inline-flex items-center gap-1 text-black dark:text-white">
              <a className="font-bold cursor-pointer"
                onClick={() => dispatch(toggleFilterFuzzyHashes([flow.fuzzy_hash, flow.id]))}
              >
                {flow.fuzzy_hash}
              </a>
            </div>
          </div>
          <div className="text-black dark:text-white">
            Source - Target (Duration):&nbsp;
            <div className="inline-flex items-center gap-1 text-black dark:text-white">
              <div>
                <span className="text-black dark:text-white">{formatIP(flow.src_ip)}</span>:
                <span className="font-bold text-black dark:text-white">{flow.src_port}</span>
              </div>
              <span className="text-black dark:text-white">-</span>
              <div>
                <span className="text-black dark:text-white">{formatIP(flow.dst_ip)}</span>:
                <span className="font-bold text-black dark:text-white">{flow.dst_port}</span>
              </div>
              <span className="italic text-black dark:text-white">({flow.duration} ms)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FlowView() {
  let [searchParams, setSearchParams] = useSearchParams();
  const params = useParams();
  const navigate = useNavigate();

  const id = params.id;

  const [reprId, setReprId] = useState(parseInt(searchParams.get(REPR_ID_KEY) ?? "0"));

  const { data: flow, isError, isLoading } = useGetFlowQuery(id!, { skip: id === undefined });

  const [triggerPwnToolsQuery] = useLazyToPwnToolsQuery();
  const [triggerFullPythonRequestQuery] = useLazyToFullPythonRequestQuery();

  async function copyAsPwn() {
    if (flow?.id) {
      const { data } = await triggerPwnToolsQuery(flow?.id);
      console.log(data);
      return data || "";
    }
    return "";
  }

  const { statusText: pwnCopyStatusText, copy: copyPwn } = useCopy({
    getText: copyAsPwn,
    copyStateToText: {
      copied: "Copied",
      default: "Copy as pwntools",
      failed: "Failed",
      copying: "Generating payload",
    },
  });

  async function copyAsRequests() {
    if (flow?.id) {
      const { data } = await triggerFullPythonRequestQuery(flow?.id);
      return data || "";
    }
    return "";
  }

  const { statusText: requestsCopyStatusText, copy: copyRequests } = useCopy({
    getText: copyAsRequests,
    copyStateToText: {
      copied: "Copied",
      default: "Copy as requests",
      failed: "Failed",
      copying: "Generating payload",
    },
  });

  // TODO: account for user scrolling - update currentFlow accordingly
  const [currentFlow, setCurrentFlow] = useState<number>(-1);

  useHotkeys("h", () => {
    // we do this for the scroll to top
    if (currentFlow === 0) {
      document.getElementById(`${id}-${currentFlow}`)?.scrollIntoView(true)
    }
    setCurrentFlow(fi => Math.max(0, fi - 1))
  }, [currentFlow]);
  useHotkeys("l", () => {
    if (currentFlow === (flow?.flow[reprId]?.flow?.length ?? 1) - 1) {
      document.getElementById(`${id}-${currentFlow}`)?.scrollIntoView(true)
    }
    setCurrentFlow(fi => Math.min((flow?.flow[reprId]?.flow?.length ?? 1) - 1, fi + 1))
  }, [currentFlow, flow?.flow[reprId]?.flow?.length, reprId]);

  useEffect(
    () => {
      if (currentFlow < 0) {
        return
      }
      document.getElementById(`${id}-${currentFlow}`)?.scrollIntoView(true)
    },
    [currentFlow]
  )

  useHotkeys("m", () => {
    setReprId(ri => (ri + 1) % (flow?.flow.length ?? 1))
  }, [reprId, flow?.flow.length]);

  // when the reprId changes, we update the url
  useEffect(
    () => {
      if (reprId === 0) {
        searchParams.delete(REPR_ID_KEY)
        setSearchParams(searchParams)
        return
      }
      searchParams.set(REPR_ID_KEY, reprId.toString());
      setSearchParams(searchParams)
    },
    [reprId]
  )

  // if the flow doesn't have the representation we're looking for, we fallback to raw
  useEffect(
    () => {
      if (flow?.flow.length == undefined || flow?.flow.length === 0) {
        return
      }
      if ((flow?.flow.length - 1) < reprId) {
        setReprId(0)
      }
    },
    [flow?.flow.length]
  )

  if (isError) {
    return <div>Error while fetching flow</div>;
  }

  if (isLoading || flow == undefined) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div
        className="sticky shadow-md top-0 bg-white dark:bg-gray-800 overflow-auto border-b border-b-gray-200 dark:border-b-gray-700 flex flex-wrap gap-2 px-2 py-1 md:py-0"
        style={{ minHeight: SECONDARY_NAVBAR_HEIGHT, zIndex: 100 }}
      >
        {(flow?.child_id != null || flow?.parent_id != null) ? (
          <div className="flex align-middle gap-2 md:gap-3 py-1">
            <button
              className="bg-yellow-700 hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-500 text-white px-2 text-xs md:text-sm rounded-md disabled:opacity-50 whitespace-nowrap"
              key={"parent" + flow.parent_id}
              disabled={flow?.parent_id === null}
              onMouseDown={(e) => {
                if (e.button === 1) { // handle opening in new tab
                  window.open(`/flow/${flow.parent_id}?${searchParams}`, "_blank")
                } else if (e.button === 0) {
                  navigate(`/flow/${flow.parent_id}?${searchParams}`)
                }
              }}
            >
              <ArrowCircleUpIcon className="inline-flex items-baseline w-4 h-4 md:w-5 md:h-5"></ArrowCircleUpIcon> <span className="hidden sm:inline">Parent</span>
            </button>
            <button
              className="bg-yellow-700 hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-500 text-white px-2 text-xs md:text-sm rounded-md disabled:opacity-50 whitespace-nowrap"
              key={"child" + flow.child_id}
              disabled={flow?.child_id === null}
              onMouseDown={(e) => {
                if (e.button === 1) { // handle opening in new tab
                  window.open(`/flow/${flow.child_id}?${searchParams}`, "_blank")
                } else if (e.button === 0) {
                  navigate(`/flow/${flow.child_id}?${searchParams}`)
                }
              }}
            >
              <ArrowCircleDownIcon className="inline-flex items-baseline w-4 h-4 md:w-5 md:h-5"></ArrowCircleDownIcon> <span className="hidden sm:inline">Child</span>
            </button>
          </div>
        ) : undefined}
        <div className="flex align-middle gap-2 md:gap-3 ml-auto py-1 flex-wrap">
          <p className="my-auto text-gray-900 dark:text-gray-100 text-xs md:text-base">Decoders <abbr title={"Number of decoders available for this flow: " + flow?.flow.length}>({flow?.flow.length})</abbr>:</p>
          <select
            id="repr-select"
            value={reprId}
            className="border-2 border-gray-700 dark:border-gray-400 bg-white dark:bg-blue-900 text-black dark:text-blue-100 px-2 text-xs md:text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            onChange={(e) => {
              const target = e.target as HTMLSelectElement;
              const newreprid = parseInt(target.value);
              setReprId(newreprid);
            }}
          >
            {flow?.flow.map((e, i) => <option key={id + "reprselect" + i} value={i} className="bg-white dark:bg-blue-900 text-black dark:text-blue-100">{e["type"]}</option>)}
          </select>
          {reprId > 0 ? <button
            className="bg-gray-700 hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-500 text-white px-2 text-xs md:text-sm rounded-md whitespace-nowrap"
            title="Diff this representation with the base"
            onClick={(e) => {
              searchParams.set(FIRST_DIFF_KEY, `${id}`);
              searchParams.set(SECOND_DIFF_KEY, `${id}:${reprId}`);
              navigate(`/diff/${id ?? ""}?${searchParams}`, { replace: true });
            }}
          >
            <LightningBoltIcon className="h-4 w-4 md:h-5 md:w-5"></LightningBoltIcon>
          </button> : undefined}
          <button
            className="bg-gray-700 hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-500 text-white px-2 text-xs md:text-sm rounded-md whitespace-nowrap"
            onClick={copyPwn}
          >
            {pwnCopyStatusText}
          </button>

          <button
            className="bg-gray-700 text-white px-2 text-xs md:text-sm rounded-md whitespace-nowrap"
            onClick={copyRequests}
          >
            {requestsCopyStatusText}
          </button>

          <button
            className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-2 text-xs md:text-sm rounded-md whitespace-nowrap"
            onClick={() => {
              const url = `${API_BASE_PATH}/flow/${id}/pcap`;
              window.location.href = url;
            }}
            title="Download this flow as a PCAP file"
          >
            <DownloadIcon className="inline-flex items-baseline w-4 h-4 md:w-5 md:h-5" /> <span className="hidden sm:inline">PCAP</span>
          </button>
        </div>
      </div>

      {flow ? <FlowOverview flow={flow}></FlowOverview> : undefined}
      {flow?.flow[(reprId < flow?.flow.length) ? reprId : 0].flow.map((flow_data, i, a) => {
        const delta_time = a[i].time - (a[i - 1]?.time ?? a[i].time);
        return (
          <Flow
            flow={flow_data}
            flow_item_index={i}
            delta_time={delta_time}
            full_flow={flow}
            key={flow.id + "-" + i}
            id={flow.id + "-" + i}
          ></Flow>
        );
      })}
    </div>
  );
}
