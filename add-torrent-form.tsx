import { useState } from "react";
import { Text } from "ink";
import { addTorrents } from "./api.js";
import { Form } from "./form.js";

interface AddTorrentFormProps {
    serverUrl: string;
    sid: string;
    defaultSavePath: string;
    onClose: () => void;
}

export function AddTorrentForm({ serverUrl, sid, defaultSavePath, onClose }: AddTorrentFormProps) {
    const [url, setUrl] = useState("");
    const [savePath, setSavePath] = useState(defaultSavePath);
    const [startPaused, setStartPaused] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function handleSubmit() {
        if (loading || !url.trim()) return;
        setLoading(true);
        setError(null);
        addTorrents(serverUrl, sid, { urls: [url.trim()], savepath: savePath, stopped: startPaused })
            .then(() => onClose())
            .catch((err) => {
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            });
    }

    return (
        <>
            <Form
                title="Add new torrent"
                fields={[
                    { label: "URL", value: url, onChange: setUrl },
                    { label: "Save path", value: savePath, onChange: setSavePath },
                    { label: "Start paused", type: "checkbox", value: startPaused, onChange: setStartPaused }
                ]}
                onSubmit={handleSubmit}
            />
            {loading && <Text color="yellow">Adding torrent...</Text>}
            {error && <Text color="red">{error}</Text>}
        </>
    );
}
