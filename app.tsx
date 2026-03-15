import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import { getMainData, stopTorrents, startTorrents, TransferInfo, type TorrentInfo } from "./api.js";
import { formatBytes } from "./format.js";
import { Table, columns, setRawStatus } from "./table.js";
import { AddTorrentForm } from "./add-torrent-form.js";

function useTerminalSize() {
    const { stdout } = useStdout();
    const [size, setSize] = useState({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });

    useEffect(() => {
        const onResize = () => setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
        stdout.on("resize", onResize);
        return () => { stdout.off("resize", onResize); };
    }, [stdout]);

    return size;
}

interface StatusBarProps {
    dl_info_speed: number;
    dl_info_data: number;
    up_info_speed: number;
    up_info_data: number;
    screenWidth: number;
}

function StatusBar({ dl_info_speed, dl_info_data, up_info_speed, up_info_data, screenWidth }: StatusBarProps) {
    const line = `Download Speed: ${formatBytes(dl_info_speed)}/s  Upload Speed: ${formatBytes(up_info_speed)}/s`;
    return <Text>{line.slice(0, screenWidth)}</Text>;
}

function HelpBar({ keys }: { keys: [string, string][] }) {
    return (
        <Text>
            {keys.map(([key, desc], i) => (
                <Text key={i}>{i > 0 ? "  " : ""}<Text bold>{key}</Text> {desc}</Text>
            ))}
        </Text>
    );
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

    return { torrents, torrents_sorted, selected_torrent, selected_torrent_index, sort_column, sort_ascending, server_state: prev.server_state };
}

interface TorrentState {
    torrents: Record<string, TorrentInfo>;
    torrents_sorted: TorrentInfo[];
    selected_torrent: string | null;
    selected_torrent_index: number;
    sort_column: number;
    sort_ascending: boolean;
    server_state: TransferInfo;
}

type Mode = "normal" | "sorting" | "add-torrent";

interface AppProps {
    url: string;
    sid: string;
    defaultSavePath: string;
    rawStatus?: boolean;
}

export function App({ url, sid, defaultSavePath, rawStatus: rawStatusProp }: AppProps) {
    setRawStatus(rawStatusProp ?? false);
    const [state, setState] = useState<TorrentState | null>(null);
    const [mode, setMode] = useState<Mode>("normal");
    const ridRef = useRef(0);
    const { columns: screenWidth, rows: screenRows } = useTerminalSize();
    const maxRows = screenRows - 5;

    const { exit } = useApp();

    useInput((input, key) => {
        if (mode === "normal") {
            if (input === "q") {
                exit();
            }

            const delta = key.upArrow ? -1 : key.downArrow ? 1 : key.pageUp ? -maxRows : key.pageDown ? maxRows : key.home ? -Infinity : key.end ? Infinity : 0;
            if (delta !== 0) {
                setState((prev) => {
                    if (prev === null || prev.torrents_sorted.length === 0) {
                        return prev;
                    }

                    const len = prev.torrents_sorted.length;
                    const new_index = Math.max(0, Math.min(len - 1, prev.selected_torrent_index + delta));

                    return { ...prev, selected_torrent_index: new_index, selected_torrent: prev.torrents_sorted[new_index].hash };
                });
            }

            if (input === "s") {
                setMode("sorting");
            }

            if (input === "t") {
                setMode("add-torrent");
            }

            if (input === "p") {
                setState((prev) => {
                    if (prev === null || prev.selected_torrent === null) return prev;
                    const torrent = prev.torrents[prev.selected_torrent];
                    if (!torrent) return prev;
                    const stopped = ["stoppedDL", "stoppedUP", "pausedDL", "pausedUP"].includes(torrent.state);
                    const action = stopped ? startTorrents : stopTorrents;
                    action(url, sid, [torrent.hash]).catch(() => {});
                    return prev;
                });
            }
        } else if (mode === "add-torrent") {
            if (key.escape) {
                setMode("normal");
            }
        } else if (mode === "sorting") {
            if (key.escape) {
                setMode("normal");
            }

            if (key.tab) {
                const dir = key.shift ? -1 : 1;
                setState((prev) => {
                    if (prev === null) return prev;
                    const new_col = (prev.sort_column + dir + columns.length) % columns.length;
                    return resortState(prev, { sort_column: new_col });
                });
            }

            if (input === " ") {
                setState((prev) => {
                    if (prev === null) return prev;
                    return resortState(prev, { sort_ascending: !prev.sort_ascending });
                });
            }
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

                const default_server_state: TransferInfo = {
                    dl_info_speed: 0,
                    dl_info_data: 0,
                    up_info_speed: 0,
                    up_info_data: 0,
                    dl_rate_limit: 0,
                    up_rate_limit: 0,
                    dht_nodes: 0,
                    connection_status: "disconnected",
                    queueing: false,
                    use_alt_speed_limits: false,
                    refresh_interval: 1000,
                };

                const server_state: TransferInfo = {
                    ...(prev?.server_state ?? default_server_state),
                    ...data.server_state,
                };

                const base: TorrentState = prev ?? {
                    torrents,
                    torrents_sorted: [],
                    selected_torrent: null,
                    selected_torrent_index: 0,
                    sort_column: 0,
                    sort_ascending: true,
                    server_state,
                };

                return { ...resortState(base, { torrents }), server_state };
            });
        }

        fetchData();
        const interval = setInterval(fetchData, 1000);
        return () => clearInterval(interval);
    }, [url, sid]);

    if (state === null) {
        return <Box width="100%" height="100%"><Text>Loading...</Text></Box>;
    }

    const helpKeys: [string, string][] = mode === "sorting"
        ? [["Tab", "column"], ["Space", "toggle order"], ["Esc", "done"]]
        : mode === "add-torrent"
        ? [["Tab", "switch field"], ["Esc", "close"]]
        : [["↑↓", "navigate"], ["←→", "scroll"], ["PgUp/PgDn", "page"], ["Home/End", "jump"], ["s", "sort"], ["t", "add torrent"], ["p", "pause/resume"], ["q", "quit"]];

    return (
        <Box width={screenWidth} height={screenRows} flexDirection="column">
            <Box flexGrow={1} flexDirection="column">
                {mode === "add-torrent"
                    ? <AddTorrentForm serverUrl={url} sid={sid} defaultSavePath={defaultSavePath} onClose={() => setMode("normal")} />
                    : <Table torrents={state.torrents_sorted} selected_torrent={state.selected_torrent} selected_torrent_index={state.selected_torrent_index} sort_column={state.sort_column} sort_ascending={state.sort_ascending} sorting={mode === "sorting"} maxRows={maxRows} screenWidth={screenWidth} />
                }
            </Box>
            <Text>{"─".repeat(screenWidth)}</Text>
            <StatusBar dl_info_speed={state.server_state?.dl_info_speed ?? 0} dl_info_data={state.server_state?.dl_info_data ?? 0} up_info_speed={state.server_state?.up_info_speed ?? 0} up_info_data={state.server_state?.up_info_data ?? 0} screenWidth={screenWidth} />
            <HelpBar keys={helpKeys} />
        </Box>
    );
}
