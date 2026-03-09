import { useState, useEffect, useRef, memo } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import { getMainData, type TorrentInfo } from "./api.js";

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, index)).toFixed(1) + " " + units[index];
}

function formatProgress(progress: number): string {
    return (progress * 100).toFixed(2) + "%";
}

interface Column {
    name: string;
    key: keyof TorrentInfo;
    width: number;
    render: (torrent: TorrentInfo) => string;
    sort: ((a: TorrentInfo, b: TorrentInfo) => number) | null;
}

const columns: Column[] = [
    { name: "Name", key: "name", width: 20, render: (t) => t.name, sort: (a, b) => a.name.localeCompare(b.name) },
    { name: "Size", key: "size", width: 10, render: (t) => formatBytes(t.size), sort: null },
    { name: "Progress", key: "progress", width: 10, render: (t) => formatProgress(t.progress), sort: null },
    { name: "Down Speed", key: "dlspeed", width: 12, render: (t) => formatBytes(t.dlspeed) + "/s", sort: null },
    { name: "Up Speed", key: "upspeed", width: 10, render: (t) => formatBytes(t.upspeed) + "/s", sort: null },
];

const TableRow = memo(function TableRow({ torrent, selected }: { torrent: TorrentInfo, selected: boolean }) {
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
});

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

function Table({ torrents, selected_torrent, selected_torrent_index, sort_column, sort_ascending, maxRows }: { torrents: TorrentInfo[], selected_torrent: string | null, selected_torrent_index: number, sort_column: number, sort_ascending: boolean, maxRows: number }) {
    const scrollOffset = useRef(0);

    if (maxRows > 0 && torrents.length > maxRows) {
        if (selected_torrent_index < scrollOffset.current) {
            scrollOffset.current = selected_torrent_index;
        } else if (selected_torrent_index >= scrollOffset.current + maxRows) {
            scrollOffset.current = selected_torrent_index - maxRows + 1;
        }
    } else {
        scrollOffset.current = 0;
    }

    const visible = maxRows > 0 ? torrents.slice(scrollOffset.current, scrollOffset.current + maxRows) : torrents;

    return (
        <Box flexDirection="column">
            <TableHeader sort_column={sort_column} sort_ascending={sort_ascending} />
            {visible.map((torrent) => <TableRow torrent={torrent} key={torrent.hash} selected={torrent.hash === selected_torrent} />)}
        </Box>
    )
}

function resortState(prev: TorrentState, overrides: Partial<Pick<TorrentState, "torrents" | "sort_column" | "sort_ascending">> = {}): TorrentState {
    const torrents = overrides.torrents ?? prev.torrents;
    const sort_column = overrides.sort_column ?? prev.sort_column;
    const sort_ascending = overrides.sort_ascending ?? prev.sort_ascending;

    const col = columns[sort_column];
    const dir = sort_ascending ? 1 : -1;
    const compare = col.sort ?? ((a: TorrentInfo, b: TorrentInfo) => (a[col.key] as number) - (b[col.key] as number));
    const torrents_sorted = Object.values(torrents).sort((a, b) => compare(a, b) * dir);

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
        const interval = setInterval(fetchData, 1000);
        return () => clearInterval(interval);
    }, [url, sid]);

    if (state === null) {
        return <Box width="100%" height="100%"><Text>Loading...</Text></Box>;
    }

    const { stdout } = useStdout();
    const maxRows = (stdout.rows ?? 24) - 1;

    return (
        <Box width="100%" height="100%" flexDirection="column">
            <Table torrents={state.torrents_sorted} selected_torrent={state.selected_torrent} selected_torrent_index={state.selected_torrent_index} sort_column={state.sort_column} sort_ascending={state.sort_ascending} maxRows={maxRows} />
        </Box>
    );
}
