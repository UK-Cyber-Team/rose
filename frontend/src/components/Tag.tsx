import classNames from "classnames";
import Color from "color";
import { useDarkMode } from "../contexts/DarkModeContext";

const computeColorFromString = (str: string) => {
  const hue = Array.from(str).reduce(
    (hash, char) => 0 | (31 * hash + char.charCodeAt(0)),
    0
  );
  return Color(`hsl(${hue}, 100%, 50%)`).hex();
};

// Hardcode colors here - with dark mode variants
const tagColorMap: Record<string, { light: string; dark: string }> = {
  fishy: { light: "rgb(191, 219, 254)", dark: "rgb(59, 130, 246)" },
  blocked: { light: "rgb(233, 213, 255)", dark: "rgb(147, 51, 234)" },
  flag_out: { light: "rgb(254, 204, 204)", dark: "rgb(239, 68, 68)" },
  flag_in: { light: "rgb(209, 213, 219)", dark: "rgb(107, 114, 128)" },
};

export function tagToColor(tag: string, isDarkMode: boolean = false) {
  const colorEntry = tagColorMap[tag];
  if (colorEntry) {
    return isDarkMode ? colorEntry.dark : colorEntry.light;
  }
  return computeColorFromString(tag);
}
interface TagProps {
  tag: string;
  color?: string;
  disabled?: boolean;
  excluded?: boolean;
  onClick?: () => void;
}
export const Tag = ({ tag, color, disabled = false, excluded = false, onClick }: TagProps) => {
  const { isDarkMode } = useDarkMode();
  
  var tagBackgroundColor = disabled 
    ? (isDarkMode ? "#4b5563" : "#eee") 
    : color ?? tagToColor(tag, isDarkMode);

  var tagTextColor = disabled
    ? (isDarkMode ? "#9ca3af" : "#bbb")
    : Color(tagBackgroundColor).isDark()
      ? "#fff"
      : "#000";

  if (excluded) {
    tagTextColor = "white";
    tagBackgroundColor = isDarkMode ? "#1f2937" : "black";
  }
  return (
    <div
      onClick={onClick}
      className={classNames("p-3 cursor-pointer rounded-md uppercase text-xs h-5 text-center flex items-center hover:opacity-90 transition-colors duration-250 text-ellipsis overflow-hidden whitespace-nowrap", {
        "bg-gray-300": disabled,
      })}
      style={{
        backgroundColor: tagBackgroundColor,
        color: tagTextColor,
      }}
    >
      <span  style={excluded ? { textDecoration: 'line-through' } : {}}>{tag}</span>
    </div>
  );
};
