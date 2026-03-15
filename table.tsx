import { useState, useRef, memo } from "react";
import { Box, Text, useInput } from "ink";
import type { TorrentInfo } from "./api.js";
import { formatBytes, formatProgress, stateIcon, stateText } from "./format.js";

function padOrTruncate(str: string, width: number): string {
    if (str.length > width) return str.slice(0, width);
    return str.padEnd(width);
}

export interface Column {
    name: string;
    key: keyof TorrentInfo;
    width: number;
    render: (torrent: TorrentInfo) => string;
    sort: ((a: TorrentInfo, b: TorrentInfo) => number) | null;
}

let rawStatus = false;

export const columns: Column[] = [
    { name: "Name", key: "name", width: 20, render: (t) => stateIcon(t.state) + " " + t.name, sort: (a, b) => a.name.localeCompare(b.name) },
    { name: "Size", key: "size", width: 10, render: (t) => formatBytes(t.size), sort: null },
    { name: "Progress", key: "progress", width: 10, render: (t) => formatProgress(t.progress), sort: null },
    { name: "Status", key: "state", width: 22, render: (t) => rawStatus ? t.state : stateText(t.state), sort: null },
    { name: "Down Speed", key: "dlspeed", width: 12, render: (t) => formatBytes(t.dlspeed) + "/s", sort: null },
    { name: "Up Speed", key: "upspeed", width: 10, render: (t) => formatBytes(t.upspeed) + "/s", sort: null },
];

export function setRawStatus(value: boolean) {
    rawStatus = value;
}

export const tableWidth = 2 + columns.reduce((sum, col) => sum + col.width, 0) + (columns.length - 1);

function viewSlice(line: string, scrollX: number, screenWidth: number): string {
    return line.slice(scrollX, scrollX + screenWidth);
}

interface TableRowProps {
    torrent: TorrentInfo;
    selected: boolean;
    scrollX: number;
    screenWidth: number;
}

const TableRow = memo(function TableRow({ torrent, selected, scrollX, screenWidth }: TableRowProps) {
    const line = "  " + columns.map((col) => padOrTruncate(col.render(torrent), col.width)).join(" ");
    return <Text inverse={selected}>{viewSlice(line, scrollX, screenWidth)}</Text>;
});

interface TableHeaderProps {
    sort_column: number;
    sort_ascending: boolean;
    sorting: boolean;
    scrollX: number;
    screenWidth: number;
}

function TableHeader({ sort_column, sort_ascending, sorting, scrollX, screenWidth }: TableHeaderProps) {
    const line = "  " + columns.map((col, i) => {
        const label = col.name + (i === sort_column ? (sort_ascending ? " ▲" : " ▼") : "");
        return padOrTruncate(label, col.width);
    }).join(" ");

    if (!sorting) {
        return <Text bold>{viewSlice(line, scrollX, screenWidth)}</Text>;
    }

    // In sorting mode, highlight the active column
    const parts: { text: string; active: boolean }[] = [];
    let pos = 2; // leading "  "
    parts.push({ text: viewSlice("  ", scrollX, screenWidth), active: false });
    columns.forEach((col, i) => {
        const label = col.name + (i === sort_column ? (sort_ascending ? " ▲" : " ▼") : "");
        const cell = padOrTruncate(label, col.width);
        const separator = i < columns.length - 1 ? " " : "";
        const chunk = cell + separator;
        const visible = viewSlice(chunk, Math.max(0, scrollX - pos), screenWidth);
        pos += chunk.length;
        if (visible.length > 0) {
            parts.push({ text: visible, active: i === sort_column });
        }
    });

    return (
        <Text bold>
            {parts.map((p, i) =>
                p.active ? <Text key={i} inverse>{p.text}</Text> : <Text key={i}>{p.text}</Text>
            )}
        </Text>
    );
}

export interface TableProps {
    torrents: TorrentInfo[];
    selected_torrent: string | null;
    selected_torrent_index: number;
    maxRows: number;
    sort_column: number;
    sort_ascending: boolean;
    sorting: boolean;
    screenWidth: number;
}

export function Table({ torrents, selected_torrent, selected_torrent_index, maxRows, sort_column, sort_ascending, sorting, screenWidth }: TableProps) {
    const scrollOffsetRef = useRef(0);
    const [scrollX, setScrollX] = useState(0);

    useInput((_input, key) => {
        const scrollXDelta = key.rightArrow ? 4 : key.leftArrow ? -4 : 0;
        if (scrollXDelta !== 0) {
            setScrollX((prev) => {
                const maxScrollX = Math.max(0, tableWidth - screenWidth);
                return Math.max(0, Math.min(maxScrollX, prev + scrollXDelta));
            });
        }
    });

    // Keep selection in view
    const maxScrollOffset = Math.max(0, torrents.length - maxRows);
    if (scrollOffsetRef.current > maxScrollOffset) {
        scrollOffsetRef.current = maxScrollOffset;
    }
    if (selected_torrent_index < scrollOffsetRef.current) {
        scrollOffsetRef.current = selected_torrent_index;
    } else if (selected_torrent_index >= scrollOffsetRef.current + maxRows) {
        scrollOffsetRef.current = selected_torrent_index - maxRows + 1;
    }

    const scrollOffset = scrollOffsetRef.current;
    const visible = maxRows > 0 ? torrents.slice(scrollOffset, scrollOffset + maxRows) : torrents;

    return (
        <Box flexDirection="column">
            <TableHeader sort_column={sort_column} sort_ascending={sort_ascending} sorting={sorting} scrollX={scrollX} screenWidth={screenWidth} />
            <Text>{"─".repeat(screenWidth)}</Text>
            {visible.map((torrent) => <TableRow torrent={torrent} key={torrent.hash} selected={torrent.hash === selected_torrent} scrollX={scrollX} screenWidth={screenWidth} />)}
        </Box>
    )
}
