import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface CheckboxProps {
    value: boolean;
    focus: boolean;
    onChange: (value: boolean) => void;
    onSubmit?: () => void;
}

export function Checkbox({ value, focus, onChange, onSubmit }: CheckboxProps) {
    useInput((input, key) => {
        if (input === " ") {
            onChange(!value);
        }
        if (key.return) {
            onSubmit?.();
        }
    }, { isActive: focus });

    return (
        <Box flexDirection="row" gap={1}>
            <Text inverse={focus}>[{value ? "✓" : " "}]</Text>
        </Box>
    );
}