import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { getMainData, type TorrentInfo } from "./api.js";

function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, index)).toFixed(2) + " " + units[index];
}

function formatProgress(progress: number): string {
    return (progress * 100).toFixed(2) + "%";
}

interface Column {
    name: string;
    width: number;
    render: (torrent: TorrentInfo) => string;
    sort: (a: TorrentInfo, b: TorrentInfo) => number;
}

const columns: Column[] = [
    { name: "Name", width: 20, render: (t) => t.name, sort: (a, b) => a.name.localeCompare(b.name) },
    { name: "Size", width: 10, render: (t) => formatBytes(t.size), sort: (a, b) => a.size - b.size },
    { name: "Progress", width: 10, render: (t) => formatProgress(t.progress), sort: (a, b) => a.progress - b.progress },
];

function TableRow({ torrent, selected }: { torrent: TorrentInfo, selected: boolean }) {
    return (
        <Box gap={1}>
            <Box width={1}>
                <Text>{selected ? "*" : " "}</Text>
            </Box>
            {columns.map((col) => (
                <Box width={col.width} key={col.name}>
                    <Text wrap="truncate">{col.render(torrent)}</Text>
                </Box>
            ))}
        </Box>
    )
}

function TableHeader({ sort_column, sort_ascending }: { sort_column: number; sort_ascending: boolean }) {
    return (
        <Box gap={1}>
            <Box width={1}>
                <Text> </Text>
            </Box>
            {columns.map((col, i) => (
                <Box width={col.width} key={col.name}>
                    <Text>{col.name}{i === sort_column ? (sort_ascending ? " ▲" : " ▼") : ""}</Text>
                </Box>
            ))}
        </Box>
    )
}

function Table({ torrents, selected_torrent, sort_column, sort_ascending }: { torrents: TorrentInfo[], selected_torrent: string | null, sort_column: number, sort_ascending: boolean }) {
    return (
        <Box flexDirection="column">
            <TableHeader sort_column={sort_column} sort_ascending={sort_ascending} />
            {torrents.map((torrent) => <TableRow torrent={torrent} key={torrent.hash} selected={torrent.hash === selected_torrent} />)}
        </Box>
    )
}

function resortState(prev: TorrentState, overrides: Partial<Pick<TorrentState, "torrents" | "sort_column" | "sort_ascending">> = {}): TorrentState {
    const torrents = overrides.torrents ?? prev.torrents;
    const sort_column = overrides.sort_column ?? prev.sort_column;
    const sort_ascending = overrides.sort_ascending ?? prev.sort_ascending;

    const col = columns[sort_column];
    const dir = sort_ascending ? 1 : -1;
    const torrents_sorted = Object.values(torrents).sort((a, b) => col.sort(a, b) * dir);

    const still_exists = prev.selected_torrent !== null && torrents[prev.selected_torrent] !== undefined;
    const selected_torrent = still_exists ? prev.selected_torrent : (torrents_sorted[0]?.hash ?? null);
    const selected_torrent_index = selected_torrent
        ? torrents_sorted.findIndex((t) => t.hash === selected_torrent)
        : 0;

    return { torrents, torrents_sorted, selected_torrent, selected_torrent_index, sort_column, sort_ascending };
}

interface TorrentState {
    torrents: Record<string, TorrentInfo>;
    torrents_sorted: TorrentInfo[];
    selected_torrent: string | null;
    selected_torrent_index: number;
    sort_column: number;
    sort_ascending: boolean;
}

export function App({ url, sid }: { url: string; sid: string }) {
    const [state, setState] = useState<TorrentState | null>(null);
    const ridRef = useRef(0);

    const { exit } = useApp();

    useInput((input, key) => {
        if (input === "q") {
            exit();
        }

        const delta = key.upArrow ? -1 : key.downArrow ? 1 : 0;
        if (delta !== 0) {
            setState((prev) => {
                if (prev === null || prev.torrents_sorted.length === 0) {
                    return prev;
                }

                const len = prev.torrents_sorted.length;
                const new_index = (prev.selected_torrent_index + delta + len) % len;
                return { ...prev, selected_torrent_index: new_index, selected_torrent: prev.torrents_sorted[new_index].hash };
            });
        }

        const col_delta = key.rightArrow ? 1 : key.leftArrow ? -1 : 0;
        if (col_delta !== 0) {
            setState((prev) => {
                if (prev === null) return prev;
                const new_col = (prev.sort_column + col_delta + columns.length) % columns.length;
                return resortState(prev, { sort_column: new_col });
            });
        }

        if (input === "s") {
            setState((prev) => {
                if (prev === null) return prev;
                return resortState(prev, { sort_ascending: !prev.sort_ascending });
            });
        }
    });

    useEffect(() => {
        async function fetchData() {
            const data = await getMainData(url, sid, ridRef.current);
            ridRef.current = data.rid;

            setState((prev) => {
                let torrents = prev?.torrents ?? {};

                if (data.full_update) {
                    torrents = {};
                }

                if (data.torrents) {
                    for (const [hash, partial] of Object.entries(data.torrents)) {
                        torrents = { ...torrents, [hash]: { ...torrents[hash], ...partial, hash } as TorrentInfo };
                    }
                }

                if (data.torrents_removed) {
                    torrents = { ...torrents };
                    for (const hash of data.torrents_removed) {
                        delete torrents[hash];
                    }
                }

                const base: TorrentState = prev ?? {
                    torrents,
                    torrents_sorted: [],
                    selected_torrent: null,
                    selected_torrent_index: 0,
                    sort_column: 0,
                    sort_ascending: true,
                };

                return resortState(base, { torrents });
            });
        }

        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [url, sid]);

    if (state === null) {
        return <Text>Loading...</Text>;
    }

    return <Table torrents={state.torrents_sorted} selected_torrent={state.selected_torrent} sort_column={state.sort_column} sort_ascending={state.sort_ascending} />;
}
