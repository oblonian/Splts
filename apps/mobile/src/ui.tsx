import React from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, styles } from './theme';

/** Primary action button with pressed feedback and a disabled state. */
export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && { opacity: 0.75 },
        disabled && { opacity: 0.4 },
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

/** Secondary/ghost button (cancel, alternate actions). */
export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.buttonSecondary, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Text style={styles.buttonSecondaryText}>{label}</Text>
    </Pressable>
  );
}

/** Labeled text input with consistent styling. */
export function Field({
  label,
  ...inputProps
}: { label?: string } & TextInputProps) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={styles.mutedText}>{label}</Text> : null}
      <TextInput style={styles.input} placeholderTextColor={colors.muted} {...inputProps} />
    </View>
  );
}

/** Inline error/warning banner. */
export function Banner({ text, kind = 'error' }: { text: string; kind?: 'error' | 'info' }) {
  return (
    <View
      style={{
        backgroundColor: kind === 'error' ? '#fdecea' : '#eaf4f0',
        borderRadius: 8,
        padding: 10,
      }}
    >
      <Text style={{ color: kind === 'error' ? colors.danger : colors.primary, fontSize: 13 }}>
        {text}
      </Text>
    </View>
  );
}
