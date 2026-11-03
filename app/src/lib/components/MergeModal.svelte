<script lang="ts">
  import { formatBytes } from "../api";
  import { parsePageSpec } from "../pageRangeParser";
  import type { FolderEntry, MergeQueueItem } from "../types";

  interface Props {
    queue: MergeQueueItem[];
    folderEntries: FolderEntry[];
    suggestedOutputPath: string;
    isBusy: boolean;
    onClose: () => void;
    onAddFileByPath: (filePath: string) => void;
    onUpdateQueueItem: (id: string, patch: Partial<MergeQueueItem>) => void;
    onMoveQueueItem: (id: string, dir: -1 | 1) => void;
    onDuplicateQueueItem: (id: string) => void;
    onRemoveQueueItem: (id: string) => void;
    onExecuteMerge: (opts: {
      outputPath: string;
      allowOverwrite: boolean;
      openAfterMerge: boolean;
    }) => void;
  }

  let {
    queue,
    folderEntries,
    suggestedOutputPath,
    isBusy,
    onClose,
    onAddFileByPath,
    onUpdateQueueItem,
    onMoveQueueItem,
    onDuplicateQueueItem,
    onRemoveQueueItem,
    onExecuteMerge,
  }: Props = $props();

  let outputPath = $state("");
  let customFilePathInput = $state("");
  let allowOverwrite = $state(false);
  let openAfterMerge = $state(true);

  $effect(() => {
    if (!outputPath && suggestedOutputPath) {
      outputPath = suggestedOutputPath;
    }
  });

  const folderPdfFiles = $derived(folderEntries.filter((e) => !e.is_dir));

  const queueValidations = $derived(
    queue.map((item) => {
      const spec = item.pageSpec.trim() || "all";
      return parsePageSpec(spec, item.totalPages);
    })
  );

  const hasAnyError = $derived(
    queue.length === 0 ||
      queueValidations.some((v) => !!v.error || v.orderedPages.length === 0)
  );

  const totalOutputPages = $derived(
    queueValidations.reduce((acc, v) => acc + v.orderedPages.length, 0)
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose}>
  <div class="modal-card" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h3>⊕ PDF結合 (ファイル別ページ範囲・回転・順序指定)</h3>
      <button type="button" class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="modal-body">
      <!-- Quick Add from Current Folder or Path -->
      <div class="add-section">
        <div class="add-top-row">
          <span class="sec-title">フォルダー内のPDFから追加:</span>
          <form
            class="manual-path-form"
            onsubmit={(e) => {
              e.preventDefault();
              if (customFilePathInput.trim()) {
                onAddFileByPath(customFilePathInput.trim());
                customFilePathInput = "";
              }
            }}
          >
            <input
              type="text"
              class="path-add-input"
              placeholder="別フォルダーのPDFフルパスを入力して追加..."
              bind:value={customFilePathInput}
            />
            <button type="submit" class="mini-add-btn">+ パス追加</button>
          </form>
        </div>

        <div class="folder-chips">
          {#each folderPdfFiles as f (f.path)}
            <button
              type="button"
              class="pdf-chip"
              title="{f.path} ({formatBytes(f.size_bytes)})"
              onclick={() => onAddFileByPath(f.path)}
            >
              + 📄 {f.name}
            </button>
          {/each}
          {#if folderPdfFiles.length === 0}
            <span class="muted">現在のフォルダーにPDFはありません（上の入力欄からフルパスで追加できます）</span>
          {/if}
        </div>
      </div>

      <!-- Merge Queue Table -->
      <div class="queue-section">
        <div class="queue-header">
          <span>結合リスト ({queue.length} 件 / 合計出力: <strong>{totalOutputPages}</strong> ページ)</span>
          <span class="hint">※各ファイルごとに抽出ページ範囲（all, 1-5, !1 等）を指定できます</span>
        </div>

        {#if queue.length === 0}
          <div class="empty-queue">
            結合するPDFファイルを上のリストからクリックして追加してください。
          </div>
        {:else}
          <div class="queue-list">
            {#each queue as item, idx (item.id)}
              {@const v = queueValidations[idx]}
              <div class="queue-row" class:row-err={!!v?.error}>
                <div class="q-idx">#{idx + 1}</div>
                <div class="q-file-info" title={item.filePath}>
                  <div class="q-fname">{item.fileName}</div>
                  <div class="q-fmeta">全 {item.totalPages}P · {formatBytes(item.sizeBytes)}</div>
                </div>

                <div class="q-spec-col">
                  <label class="q-mini-label">
                    <span>対象ページ:</span>
                    <input
                      type="text"
                      class="q-spec-input"
                      placeholder="all または 1-5, 8"
                      value={item.pageSpec}
                      oninput={(e) =>
                        onUpdateQueueItem(item.id, {
                          pageSpec: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  {#if v?.error}
                    <div class="q-err-msg">{v.error}</div>
                  {:else}
                    <div class="q-ok-msg">{v.orderedPages.length} ページ対象</div>
                  {/if}
                </div>

                <div class="q-rot-col">
                  <label class="q-mini-label">
                    <span>追加回転:</span>
                    <select
                      value={item.addedRotation}
                      onchange={(e) =>
                        onUpdateQueueItem(item.id, {
                          addedRotation: Number(
                            (e.currentTarget as HTMLSelectElement).value
                          ),
                        })}
                    >
                      <option value={0}>0°</option>
                      <option value={90}>+90°</option>
                      <option value={180}>180°</option>
                      <option value={270}>-90°</option>
                    </select>
                  </label>
                </div>

                <div class="q-actions">
                  <button
                    type="button"
                    class="q-act-btn"
                    disabled={idx === 0}
                    title="上へ移動"
                    onclick={() => onMoveQueueItem(item.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="q-act-btn"
                    disabled={idx === queue.length - 1}
                    title="下へ移動"
                    onclick={() => onMoveQueueItem(item.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="q-act-btn"
                    title="このエントリを複製（別ページ範囲を差し込むときに便利）"
                    onclick={() => onDuplicateQueueItem(item.id)}
                  >
                    複製
                  </button>
                  <button
                    type="button"
                    class="q-act-btn danger"
                    title="結合リストから除外"
                    onclick={() => onRemoveQueueItem(item.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Output Path & Options -->
      <div class="field-group">
        <label for="merge-output-path">結合後の保存先ファイルパス:</label>
        <input
          id="merge-output-path"
          type="text"
          class="full-input"
          bind:value={outputPath}
        />
      </div>

      <div class="options-row">
        <label class="check-row">
          <input type="checkbox" bind:checked={allowOverwrite} />
          <span>出力先に同名ファイルがある場合に上書きを許可する</span>
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={openAfterMerge} />
          <span>結合完了後に作成されたPDFをすぐ開く</span>
        </label>
      </div>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick={onClose} disabled={isBusy}>
        キャンセル
      </button>
      <button
        type="button"
        class="btn-primary"
        disabled={isBusy || hasAnyError || !outputPath.trim()}
        onclick={() =>
          onExecuteMerge({
            outputPath: outputPath.trim(),
            allowOverwrite,
            openAfterMerge,
          })}
      >
        {isBusy ? "結合処理中..." : `PDF結合を実行 (${totalOutputPages} ページ)`}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-card {
    width: 100%;
    max-width: 760px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-accent);
    border-radius: 6px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--nord0);
    border-bottom: 1px solid var(--ui-border);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 14px;
    color: var(--ui-fg-bright);
  }

  .close-btn {
    font-size: 18px;
    padding: 0 6px;
  }

  .modal-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .add-section {
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .add-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sec-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--ui-fg-bright);
  }

  .manual-path-form {
    display: flex;
    gap: 4px;
    flex: 1;
    max-width: 400px;
  }

  .path-add-input {
    flex: 1;
    font-size: 11px;
    padding: 3px 7px;
  }

  .mini-add-btn {
    padding: 3px 8px;
    font-size: 11px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
    white-space: nowrap;
  }

  .folder-chips {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    max-height: 75px;
    overflow-y: auto;
  }

  .pdf-chip {
    padding: 3px 8px;
    font-size: 11px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
    color: var(--ui-fg-bright);
  }

  .pdf-chip:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
  }

  .muted {
    font-size: 11px;
    color: var(--nord3);
  }

  .queue-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .queue-header {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    flex-wrap: wrap;
    gap: 4px;
  }

  .hint {
    font-size: 11px;
    color: var(--nord4);
  }

  .empty-queue {
    padding: 20px;
    text-align: center;
    background: var(--nord0);
    border: 1px dashed var(--ui-border);
    border-radius: 4px;
    color: var(--nord3);
    font-size: 12px;
  }

  .queue-list {
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .queue-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    flex-wrap: wrap;
  }

  .queue-row.row-err {
    border-color: var(--ui-danger);
  }

  .q-idx {
    font-weight: 700;
    color: var(--ui-accent);
    min-width: 22px;
  }

  .q-file-info {
    flex: 1;
    min-width: 140px;
  }

  .q-fname {
    font-weight: 600;
    color: var(--ui-fg-bright);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .q-fmeta {
    font-size: 10px;
    color: var(--nord3);
  }

  .q-spec-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .q-mini-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }

  .q-spec-input {
    width: 125px;
    padding: 2px 6px;
    font-size: 11px;
  }

  .q-err-msg {
    font-size: 10px;
    color: var(--ui-danger);
  }

  .q-ok-msg {
    font-size: 10px;
    color: var(--ui-success);
  }

  .q-actions {
    display: flex;
    gap: 3px;
  }

  .q-act-btn {
    padding: 2px 7px;
    font-size: 11px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
  }

  .q-act-btn:hover:not(:disabled) {
    border-color: var(--ui-accent);
  }

  .q-act-btn.danger:hover {
    border-color: var(--ui-danger);
    color: var(--ui-danger);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-group label {
    font-size: 12px;
    font-weight: 700;
    color: var(--ui-fg-bright);
  }

  .full-input {
    width: 100%;
    padding: 6px 9px;
    font-size: 12px;
  }

  .options-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    background: var(--nord0);
    border-top: 1px solid var(--ui-border);
  }

  .btn-secondary {
    padding: 5px 12px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
  }

  .btn-primary {
    padding: 5px 14px;
    background: var(--ui-accent);
    color: #111827;
    font-weight: 700;
    border: 1px solid var(--ui-accent);
  }
</style>
