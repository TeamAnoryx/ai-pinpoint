/** "All chats" tab: threads for the current host, newest first (UI_SPEC.md §7). */
import { useEffect } from 'preact/hooks';
import { formatRelative } from '@shared/time';
import { useOverlay } from './context';
import { Icon } from './icons';

export function ThreadList() {
  const { model, intents } = useOverlay();
  const { threads, hostLabel, threadId } = model.engine.value;

  useEffect(() => {
    void intents.loadThreads();
  }, []);

  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  if (sorted.length === 0) {
    return (
      <div class="pp-empty" role="status">
        <Icon name="pin" size={24} />
        <p>No pinned chats on this site yet.</p>
      </div>
    );
  }
  return (
    <ul class="pp-list" role="list" aria-label="Chats with pins">
      {sorted.map((t) => (
        <li key={t.threadId} role="listitem">
          <button
            type="button"
            class="pp-thread"
            aria-current={t.threadId === threadId ? 'page' : undefined}
            aria-label={`${t.title ?? 'Untitled chat'}, ${t.pinCount} pins`}
            onClick={() => {
              model.tab.value = 'chat';
              intents.openThread(t.url);
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', gap: '8px' }}>
                <span class="pp-thread-title">{t.title ?? 'Untitled chat'}</span>
                <span class="pp-thread-sub">{t.pinCount} pins</span>
              </span>
              <span class="pp-thread-sub">
                {hostLabel} · {formatRelative(t.updatedAt, model.now.value)}
              </span>
            </span>
            <Icon name="external-link" />
          </button>
        </li>
      ))}
    </ul>
  );
}
