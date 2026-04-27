import type { ViewId } from "../types";
import { NAV_ITEMS } from "../types";

type Props = {
  activeView: ViewId;
  onSelect: (id: ViewId) => void;
};

export function MainTabs({ activeView, onSelect }: Props) {
  return (
    <div className="main-tabs no-drag" role="tablist">
      {NAV_ITEMS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`main-tab${activeView === id ? " is-active" : ""}`}
          role="tab"
          aria-selected={activeView === id}
          data-view={id}
          onClick={() => onSelect(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
