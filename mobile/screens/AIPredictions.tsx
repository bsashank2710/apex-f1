/**
 * AIPredictions — AI race intelligence powered by Claude, called directly
 * from the frontend so responses stream in immediately.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { getAnthropicAppKey, live } from '../lib/api';
import { useOpenF1LiveContext } from '../hooks/useOpenF1LiveContext';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';

/** Matches a model your Anthropic key can call (3.5 IDs often 404 on newer accounts). */
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// ── Direct Claude streaming call ───────────────────────────────────────────────

async function streamClaude(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
) {
  const apiKey = getAnthropicAppKey();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude error ${res.status}: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          onChunk(parsed.delta.text);
        }
      } catch {}
    }
  }
}

// ── Context builder ───────────────────────────────────────────────────────────

async function buildRaceContext(sessionKey?: number | string | null) {
  if (sessionKey === null) {
    return { snapshot: null, drivers: [] as unknown[] };
  }
  try {
    const key = sessionKey ?? 'latest';
    const [snapshot, drivers] = await Promise.allSettled([
      live.snapshot(key),
      live.drivers(key),
    ]);
    return {
      snapshot: snapshot.status === 'fulfilled' ? snapshot.value : null,
      drivers: drivers.status === 'fulfilled' ? drivers.value?.slice(0, 20) : [],
    };
  } catch {
    return { snapshot: null, drivers: [] };
  }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

/**
 * Renders inline markdown: **bold**, *italic*, `code`
 */
function InlineMarkdown({ text, style }: { text: string; style?: any }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <Text key={i} style={md.bold}>{part.slice(2, -2)}</Text>;
        if (part.startsWith('*') && part.endsWith('*'))
          return <Text key={i} style={md.italic}>{part.slice(1, -1)}</Text>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <Text key={i} style={md.code}>{part.slice(1, -1)}</Text>;
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

/**
 * Renders full markdown content with headings, bullets, numbered lists,
 * horizontal rules, and paragraphs.
 */
function MarkdownContent({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<View key={i} style={md.hr} />);
      i++;
      continue;
    }

    // Heading ### / ## / #
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      elements.push(
        <InlineMarkdown
          key={i}
          text={headingMatch[2]}
          style={level === 1 ? md.h1 : level === 2 ? md.h2 : md.h3}
        />
      );
      i++;
      continue;
    }

    // Bullet point (- or * or •)
    const bulletMatch = line.match(/^[\-\*•]\s+(.+)/);
    if (bulletMatch) {
      elements.push(
        <View key={i} style={md.bulletRow}>
          <Text style={md.bulletDot}>•</Text>
          <InlineMarkdown text={bulletMatch[1]} style={md.bulletText} />
        </View>
      );
      i++;
      continue;
    }

    // Numbered list
    const numMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      elements.push(
        <View key={i} style={md.bulletRow}>
          <Text style={md.numDot}>{numMatch[1]}.</Text>
          <InlineMarkdown text={numMatch[2]} style={md.bulletText} />
        </View>
      );
      i++;
      continue;
    }

    // Empty line → spacing
    if (line.trim() === '') {
      if (elements.length > 0) elements.push(<View key={i} style={md.spacer} />);
      i++;
      continue;
    }

    // Normal paragraph line
    elements.push(
      <InlineMarkdown key={i} text={line} style={md.para} />
    );
    i++;
  }

  return (
    <View>
      {elements}
      {streaming && <Text style={md.cursor}>▊</Text>}
    </View>
  );
}

const md = StyleSheet.create({
  h1:        { color: '#ffffff', fontSize: 15, fontWeight: '900', letterSpacing: 1, marginBottom: 6, marginTop: 4 },
  h2:        { color: '#ffffff', fontSize: 13, fontWeight: '800', letterSpacing: 0.5, marginBottom: 4, marginTop: 6 },
  h3:        { color: Colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4, marginTop: 6 },
  bold:      { fontWeight: '700', color: '#ffffff' },
  italic:    { fontStyle: 'italic', color: '#ccc' },
  code:      { fontFamily: 'monospace', backgroundColor: '#1a1a2e', color: '#00E5A0', paddingHorizontal: 4, borderRadius: 3, fontSize: 11 },
  para:      { color: '#c8c8c8', fontSize: 13, lineHeight: 21 },
  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 },
  bulletDot: { color: Colors.primary, fontSize: 13, lineHeight: 21, marginTop: 1, width: 12 },
  numDot:    { color: Colors.primary, fontSize: 12, lineHeight: 21, fontWeight: '700', width: 20 },
  bulletText:{ flex: 1, color: '#c8c8c8', fontSize: 13, lineHeight: 21 },
  hr:        { height: 1, backgroundColor: '#1e1e2e', marginVertical: 10 },
  spacer:    { height: 8 },
  cursor:    { color: Colors.primary, fontSize: 13 },
});

// ── Chat components ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
      {!isUser && <Text style={styles.bubbleLabel}>APEX AI</Text>}
      {isUser ? (
        <Text style={styles.userText}>{msg.content}</Text>
      ) : (
        <MarkdownContent text={msg.content} streaming={msg.streaming} />
      )}
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function AIPredictions() {
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const { effectiveKey } = useOpenF1LiveContext();
  const sessionKeyForAi =
    effectiveKey === null ? null : effectiveKey === 'latest' ? 'latest' : effectiveKey;

  const scrollToEnd = () =>
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text ?? chatInput).trim();
    if (!msg || isStreaming) return;
    if (!text) setChatInput('');

    if (!getAnthropicAppKey()) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: msg },
        { role: 'assistant', content: 'No API key set. Add EXPO_PUBLIC_ANTHROPIC_API_KEY to mobile/.env and restart Expo.' },
      ]);
      return;
    }

    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    scrollToEnd();

    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);
    scrollToEnd();

    try {
      const ctx = await buildRaceContext(sessionKeyForAi);
      const system = `You are APEX, an elite F1 race intelligence AI. Be concise, sharp, and data-driven.
Live race context: ${JSON.stringify(ctx)}`;

      const history = messagesRef.current
        .filter((m) => !m.streaming && m.content)
        .map((m) => ({ role: m.role, content: m.content }));

      abortRef.current = new AbortController();
      let full = '';

      await streamClaude(
        [...history, { role: 'user', content: msg }],
        system,
        (chunk) => {
          full += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: full, streaming: true };
            return updated;
          });
          scrollToEnd();
        },
        abortRef.current.signal,
      );

      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: full, streaming: false };
        return updated;
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false };
          return updated;
        });
        return;
      }
      const msg = err.message?.includes('credit') || err.message?.includes('billing')
        ? 'Your Claude API account has no credits. Add credits at console.anthropic.com/settings/billing'
        : `Error: ${err.message}`;
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: msg, streaming: false };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [chatInput, isStreaming, sessionKeyForAi]);

  const QUICK_PROMPTS = [
    'Who will win this race and why?',
    'What are the key strategy calls right now?',
    'Safety car risk in the next 10 laps?',
    'Who is underperforming vs their pace?',
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>AI RACE INTELLIGENCE</Text>
        <Text style={styles.subtitle}>Powered by Claude · Streams live</Text>

        {messages.length === 0 && (
          <View style={styles.quickSection}>
            <Text style={styles.quickLabel}>QUICK ANALYSIS</Text>
            {QUICK_PROMPTS.map((p) => (
              <TouchableOpacity
                key={p}
                style={styles.quickBtn}
                onPress={() => sendMessage(p)}
                activeOpacity={0.7}
                disabled={isStreaming}
              >
                <Text style={styles.quickBtnText}>{p}</Text>
                <Text style={styles.quickArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {messages.length > 0 && (
          <View style={styles.chat}>
            {messages.map((msg, i) => (
              <Bubble key={i} msg={msg} />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.chatInput}
          placeholder="Ask anything about the race…"
          placeholderTextColor={Colors.textMuted}
          value={chatInput}
          onChangeText={setChatInput}
          onSubmitEditing={() => sendMessage()}
          returnKeyType="send"
          multiline={false}
          editable={!isStreaming}
        />
        {isStreaming ? (
          <TouchableOpacity
            style={[styles.sendButton, styles.stopButton]}
            onPress={() => abortRef.current?.abort()}
          >
            <Text style={styles.sendButtonText}>STOP</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, !chatInput.trim() && styles.sendButtonDisabled]}
            onPress={() => sendMessage()}
            disabled={!chatInput.trim()}
          >
            <Text style={styles.sendButtonText}>ASK</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl },

  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900', letterSpacing: 2 },
  subtitle: { color: Colors.primary, fontSize: FontSize.xs, marginBottom: Spacing.lg, letterSpacing: 1 },

  quickSection: { gap: Spacing.xs },
  quickLabel: {
    color: Colors.textMuted, fontSize: 10, fontWeight: '800',
    letterSpacing: 2, marginBottom: Spacing.xs,
  },
  quickBtn: {
    backgroundColor: Colors.surface, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  quickBtnText: { color: Colors.text, fontSize: FontSize.sm, flex: 1 },
  quickArrow: { color: Colors.primary, fontSize: 20, fontWeight: '300' },

  chat: { gap: Spacing.sm },

  bubble: { padding: Spacing.sm, borderRadius: Radius.md, maxWidth: '88%' },
  userBubble: {
    backgroundColor: Colors.primary, alignSelf: 'flex-end', borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: Colors.surface, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4,
  },
  bubbleLabel: {
    color: Colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4,
  },
  bubbleText: { fontSize: FontSize.sm, lineHeight: 20 },
  userText: { color: Colors.text },
  aiText: { color: Colors.text },
  cursor: { color: Colors.primary },

  inputRow: {
    flexDirection: 'row', gap: Spacing.sm,
    padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chatInput: {
    flex: 1, backgroundColor: Colors.surface, color: Colors.text,
    borderRadius: Radius.sm, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.border,
    fontSize: FontSize.sm,
  },
  sendButton: {
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, justifyContent: 'center',
  },
  stopButton: { backgroundColor: '#333' },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: Colors.text, fontWeight: '700', fontSize: FontSize.xs },
});
