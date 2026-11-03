<script lang="ts">
  import { parsePageSpec } from "../pageRangeParser";

  interface Props {
    mode: "save" | "extract";
    totalPages: number;
    initialPageSpec: string;
    suggestedOutputPath: string;
    outputDir: string;
    baseFileStem: string;
    isBusy: boolean;
    onClose: () => void;
    onConfirmSaveSingle: (opts: {
      outputPath: string;
      pageNumbers: number[];
      includeAnnotations: boolean;
      allowOverwrite: boolean;
      openAfterSave: boolean;
    }) => void;
    onConfirmExtractIndividual: (opts: {
      outputDir: string;
      basePrefix: string;
      pageNumbers: number[];
      includeAnnotations: boolean;
      allowOverwrite: boolean;
    }) => void;
  }

  let {
    mode,
    totalPages,
    initialPageSpec,
    suggestedOutputPath,
    outputDir,
    baseFileStem,
    isBusy,
    onClose,
    onConfirmSaveSingle,
    onConfirmExtractIndividual,
  }: Props = $props();

  let outputPath = $state("");
  let pageSpec = $state("");
  let extractFormat = $state<"single" | "individual">("single");
  let keepSpecOrder = $state(true);
  let includeAnnotations = $state(true);
  let allowOverwrite = $state(false);
  let openAfterSave = $state(false);
  let individualPrefix = $state("");

  $effect(() => {
    outputPath = suggestedOutputPath;
    pageSpec = mode === "extract" ? initialPageSpec || "1" : "all";
    individualPrefix = `${baseFileStem}_extracted`;
  });

  const parsedSpec = $derived(parsePageSpec(pageSpec, totalPages));
  const targetPages = $derived(
    mode === "save"
      ? Array.from({ length: totalPages }, (_, i) => i + 1)
      : keepSpecOrder
        ? parsedSpec.orderedPages
        : parsedSpec.pages
  );

  function handleSubmit() {
    if (mode === "save") {
      onConfirmSaveSingle({
        outputPath: outputPath.trim(),
        pageNumbers: targetPages,
        includeAnnotations,
        allowOverwrite,
        openAfterSave,
      });
      return;
    }

    if (parsedSpec.error || targetPages.length === 0) return;

    if (extractFormat === "single") {
      onConfirmSaveSingle({
        outputPath: outputPath.trim(),
        pageNumbers: targetPages,
        includeAnnotations,
        allowOverwrite,
        openAfterSave,
      });
    } else {
      onConfirmExtractIndividual({
        outputDir: outputDir.trim(),
        basePrefix: individualPrefix.trim() || `${baseFileStem}_p`,
        pageNumbers: targetPages,
        includeAnnotations,
        allowOverwrite,
      });
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose}>
  <div class="modal-card" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h3>
        {mode === "save"
          ? "💾 PDFを別名で保存"
          : "✂ ページ抽出 (ページ番号・範囲指定)"}
      </h3>
      <button type="button" class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="modal-body">
      {#if mode === "extract"}
        <div class="field-group">
          <label for="extract-spec-input">
            抽出するページ番号・範囲指定 (全 {totalPages} ページ):
          </label>
          <input
            id="extract-spec-input"
            type="text"
            class="full-input"
            placeholder="例: 1-5, 8, 12-end, odd, even, !3"
            bind:value={pageSpec}
          />
          <div class="spec-helper">
            {#if parsedSpec.error}
              <span class="err-text">⚠ {parsedSpec.error}</span>
            {:else}
              <span class="ok-text">
                ✓ 抽出対象: <strong>{targetPages.length}</strong> ページ
                {#if targetPages.length > 0}
                  (先頭: {targetPages.slice(0, 12).join(", ")}{targetPages.length > 12 ? " ..." : ""})
                {/if}
              </span>
            {/if}
          </div>
          <div class="quick-spec-chips">
            <button type="button" class="chip" onclick={() => (pageSpec = "all")}>全ページ (all)</button>
            <button type="button" class="chip" onclick={() => (pageSpec = "odd")}>奇数 (odd)</button>
            <button type="button" class="chip" onclick={() => (pageSpec = "even")}>偶数 (even)</button>
            <button type="button" class="chip" onclick={() => (pageSpec = "!1")}>表紙(P.1)以外 (!1)</button>
          </div>
        </div>

        <div class="field-group">
          <span class="label-text">出力方式:</span>
          <div class="radio-row">
            <label class="radio-label">
              <input type="radio" value="single" bind:group={extractFormat} />
              <span>1つのPDFファイルにまとめて出力</span>
            </label>
            <label class="radio-label">
              <input type="radio" value="individual" bind:group={extractFormat} />
              <span>1ページずつ個別のPDFとして出力 ({targetPages.length} ファイル)</span>
            </label>
          </div>
        </div>

        {#if extractFormat === "single"}
          <label class="check-row">
            <input type="checkbox" bind:checked={keepSpecOrder} />
            <span>ページ指定に記述した順番どおりに並べる（例: <code>10, 1-5</code> で10Pを先頭に配置）</span>
          </label>
        {/if}
      {/if}

      {#if mode === "save" || extractFormat === "single"}
        <div class="field-group">
          <label for="save-output-path">保存先ファイルパス:</label>
          <input
            id="save-output-path"
            type="text"
            class="full-input"
            bind:value={outputPath}
          />
        </div>
      {:else}
        <div class="field-group">
          <label for="ind-dir">出力先フォルダー:</label>
          <input id="ind-dir" type="text" class="full-input" bind:value={outputDir} />
        </div>
        <div class="field-group">
          <label for="ind-prefix">ファイル名接頭辞 (例: <code>{individualPrefix}_p001.pdf</code>):</label>
          <input id="ind-prefix" type="text" class="full-input" bind:value={individualPrefix} />
        </div>
      {/if}

      <div class="options-box">
        <label class="check-row">
          <input type="checkbox" bind:checked={includeAnnotations} />
          <span>追加した注釈・ハイライトをPDFに焼き込んで保存する</span>
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={allowOverwrite} />
          <span>出力先に同名ファイルが存在する場合に上書きを許可する</span>
        </label>
        {#if mode === "save" || extractFormat === "single"}
          <label class="check-row">
            <input type="checkbox" bind:checked={openAfterSave} />
            <span>保存完了後にそのPDFファイルをすぐ開く</span>
          </label>
        {/if}
      </div>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick={onClose} disabled={isBusy}>
        キャンセル
      </button>
      <button
        type="button"
        class="btn-primary"
        disabled={isBusy || (mode === "extract" && (!!parsedSpec.error || targetPages.length === 0))}
        onclick={handleSubmit}
      >
        {isBusy
          ? "処理中..."
          : mode === "save"
            ? "別名で保存を実行"
            : "ページ抽出を実行"}
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
    max-width: 580px;
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
    color: var(--ui-fg);
  }

  .modal-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-group label,
  .label-text {
    font-size: 12px;
    font-weight: 700;
    color: var(--ui-fg-bright);
  }

  .full-input {
    width: 100%;
    padding: 6px 9px;
    font-size: 12px;
  }

  .spec-helper {
    font-size: 11px;
  }

  .err-text {
    color: var(--ui-danger);
    font-weight: 700;
  }

  .ok-text {
    color: var(--ui-success);
  }

  .quick-spec-chips {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .chip {
    padding: 2px 8px;
    font-size: 11px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
  }

  .chip:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
  }

  .radio-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
  }

  .radio-label,
  .check-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    cursor: pointer;
  }

  .options-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
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
