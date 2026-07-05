"use client";

import { useState } from "react";
import useSWR from "swr";
import type { FolderNode } from "@/lib/library/folder-tree";
import { fetcher } from "@/lib/fetcher";

// FolderTree — a browsable rail mirroring the library's on-disk shelf layout.
//
// Data comes from GET /api/library/folders, which already strips scan roots, so
// every `path` here is relative ("python/web") — absolute filesystem paths
// never reach the client. Selecting a folder hands its relative path up via
// onSelect; the page re-queries /api/books?folder=<path>. The virtual root
// ("" path) is the "All books" affordance that clears the filter.

interface Props {
  // The currently selected folder path ("" = all books / no filter).
  selected: string;
  onSelect: (path: string) => void;
}

export function FolderTree({ selected, onSelect }: Props) {
  const { data } = useSWR<{ tree: FolderNode }>(
    "/api/library/folders",
    fetcher,
    // The tree changes when a scan adds/removes folders; a slow refresh keeps
    // it from going stale next to the 5s book grid (manual rescans also
    // mutate this key directly).
    { refreshInterval: 30000 },
  );
  const tree = data?.tree;

  return (
    <nav aria-label="Folders" className="space-y-1 text-sm">
      <button
        type="button"
        onClick={() => onSelect("")}
        className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
          selected === ""
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
      >
        <span className="font-medium">All books</span>
        {tree && (
          <span className="ml-auto text-xs text-zinc-600">
            {tree.totalCount}
          </span>
        )}
      </button>

      {tree?.children.map((child) => (
        <FolderRow
          key={child.path}
          node={child}
          depth={0}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

interface RowProps {
  node: FolderNode;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
}

function FolderRow({ node, depth, selected, onSelect }: RowProps) {
  const [manuallyOpen, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const isSelected = selected === node.path;
  // Keep ancestors of the active selection expanded — a selected row hidden
  // inside a collapsed branch reads as "my filter vanished".
  const containsSelection =
    !isSelected && selected.startsWith(`${node.path}/`);
  const open = manuallyOpen || containsSelection;

  return (
    <div>
      <div
        className={`flex items-baseline gap-1 rounded-md outline-none transition-colors ${
          isSelected
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
        // Indent deeper folders without nudging the disclosure column out of line.
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="px-1 text-zinc-600 outline-none transition-colors hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            <span className="inline-block w-2">{open ? "▾" : "▸"}</span>
          </button>
        ) : (
          // Keep the label column aligned when there's no triangle.
          <span className="px-1">
            <span className="inline-block w-2" />
          </span>
        )}

        <button
          type="button"
          onClick={() => onSelect(node.path)}
          className="flex flex-1 items-baseline gap-2 px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
        >
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-xs text-zinc-600">
            {node.totalCount}
          </span>
        </button>
      </div>

      {hasChildren && open && (
        <div className="mt-1 space-y-1">
          {node.children.map((c) => (
            <FolderRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
