<script lang="ts">
  import { formatBytes } from "../api";
  import type {
    FolderEntry,
    OutlineItem,
    PdfAnnotation,
    SidebarTab,
    VirtualPage,
  } from "../types";
  import ThumbnailItem from "./ThumbnailItem.svelte";

  interface Props {
    activeTab: SidebarTab;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfDoc: any;
    virtualPages: VirtualPage[];
    currentPage: number;
    selectedPagesSet: Set<number>;
    annotationsByPageId: Record<string, PdfAnnotation[]>;
    outlineItems: OutlineItem[];
    drives: string[];
    currentDir: string;
    parentDir: string | null;
    folderEntries: FolderEntry[];
    activeFilePath: string;
    onChangeTab: (tab: SidebarTab) => void;
    onJumpToPage: (pageNum: number) => void;
    onToggleSelectPage: (pageNum: number, shiftKey: boolean) => void;
    onRotatePage: (pageNum: number, delta: number) => void;
    onMovePage: (pageNum: number, dir: -1 | 1) => void;
    onDeletePage: (pageNum: number) => void;
    onSelectAnnotation: (pageNum: number, annId: string) => void;
    onDeleteAnnotation: (pageId: string, annId: string) => void;
    onClearAllAnnotations: () => void;
    onNavigateFolder: (dirPath: string) => void;
    onOpenPdfFile: (filePath: string) => void;
    onQuickAddMergePdf: (filePath: string) => void;
  }

  let {
    activeTab,
    pdfDoc,
    virtualPages,
    currentPage,
    selectedPagesSet,
    annotationsByPageId,
    outlineItems,
    drives,
    currentDir,
    parentDir,
    folderEntries,
    activeFilePath,
    onChangeTab,
    onJumpToPage,
    onToggleSelectPage,
    onRotatePage,
    onMovePage,
    onDeletePage,
    onSelectAnnotation,
    onDeleteAnnotation,
    onClearAllAnnotations,
    onNavigateFolder,
    onOpenPdfFile,
    onQuickAddMergePdf,
  }: Props = $props();

  const KIND_LABELS: Record<PdfAnnotation["kind"], string> = {
    highlight: "ハイライト",
    text: "文字記入",
    sticky: "付箋メモ",
    rect: "四角枠",
    arrow: "矢印",
    line: "直線",
    pen: "ペン描画",
  };

  const flatAnnotationRows = $derived.by(() => {
    const list: Array<{
      pageNum: number;
      pageId: string;
      ann: PdfAnnotation;
    }> = [];
    virtualPages.forEach((vp, idx) => {
      const anns = annotationsByPageId[vp.id] ?? [];
      for (const ann of anns) {
        list.push({
          pageNum: idx + 1,
          pageId: vp.id,
          ann,
        });
      }
    });
    return list;
  });

  let customPathInput = $state("");

  $effect(() => {
    customPathInput = currentDir;
  });
</script>

<aside class="sidebar-panel">
  <div class="sidebar-tabs">
    <button
      type="button"
      class="s-tab"
      class:active={activeTab === "pages"}
      onclick={() => onChangeTab("pages")}
    >
      ページ ({virtualPages.length})
    </button>
    <button
      type="button"
      class="s-tab"
      class:active={activeTab === "annotations"}
      onclick={() => onChangeTab("annotations")}
    >
      注釈 ({flatAnnotationRows.length})
    </button>
    <button
      type="button"
      class="s-tab"
      class:active={activeTab === "outline"}
      onclick={() => onChangeTab("outline")}
    >
      目次
    </button>
    <button
      type="button"
      class="s-tab"
      class:active={activeTab === "folder"}
      onclick={() => onChangeTab("folder")}
    >
      フォルダー
    </button>
  </div>

  <div class="sidebar-body">
    {#if activeTab === "pages"}
      {#if virtualPages.length === 0}
        <div class="empty-msg">PDFファイルを開くとページ一覧が表示されます</div>
      {:else}
        <div class="thumb-list">
          {#each virtualPages as vp, idx (vp.id)}
            {@const pNum = idx + 1}
            <ThumbnailItem
              {pdfDoc}
              vPage={vp}
              displayPageNumber={pNum}
              isCurrent={currentPage === pNum}
              isSelected={selectedPagesSet.has(pNum)}
              annotationCount={(annotationsByPageId[vp.id] ?? []).length}
              thumbWidth={150}
              {onJumpToPage}
              onToggleSelect={onToggleSelectPage}
              {onRotatePage}
              {onMovePage}
              {onDeletePage}
            />
          {/each}
        </div>
      {/if}
    {:else if activeTab === "annotations"}
      {#if flatAnnotationRows.length === 0}
        <div class="empty-msg">
          注釈はまだありません。<br />
          上部のツールバーからハイライト・文字記入・付箋メモ・図形を追加できます。
        </div>
      {:else}
        <div class="ann-list-header">
          <span>全 {flatAnnotationRows.length} 件の注釈</span>
          <button
            type="button"
            class="clear-all-btn"
            onclick={onClearAllAnnotations}
          >
            すべて消去
          </button>
        </div>
        <div class="ann-list">
          {#each flatAnnotationRows as row (row.ann.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="ann-item"
              onclick={() => onSelectAnnotation(row.pageNum, row.ann.id)}
            >
              <div class="ann-item-top">
                <span class="ann-page-badge">P.{row.pageNum}</span>
                <span
                  class="ann-color-chip"
                  style="background: {row.ann.color};"
                ></span>
                <span class="ann-kind-text">{KIND_LABELS[row.ann.kind]}</span>
                <button
                  type="button"
                  class="ann-del-btn"
                  title="この注釈を削除"
                  onclick={(e) => {
                    e.stopPropagation();
                    onDeleteAnnotation(row.pageId, row.ann.id);
                  }}
                >
                  ×
                </button>
              </div>
              {#if row.ann.text}
                <div class="ann-text-preview">{row.ann.text}</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else if activeTab === "outline"}
      {#if outlineItems.length === 0}
        <div class="empty-msg">このPDFには目次（しおり）情報がありません</div>
      {:else}
        <div class="outline-tree">
          {#each outlineItems as item}
            <div class="outline-node">
              <button
                type="button"
                class="outline-btn"
                disabled={!item.pageNumber}
                onclick={() => item.pageNumber && onJumpToPage(item.pageNumber)}
              >
                <span class="o-title">{item.title}</span>
                {#if item.pageNumber}
                  <span class="o-page">P.{item.pageNumber}</span>
                {/if}
              </button>
              {#if item.children.length > 0}
                <div class="outline-children">
                  {#each item.children as sub}
                    <button
                      type="button"
                      class="outline-btn sub"
                      disabled={!sub.pageNumber}
                      onclick={() => sub.pageNumber && onJumpToPage(sub.pageNumber)}
                    >
                      <span class="o-title">{sub.title}</span>
                      {#if sub.pageNumber}
                        <span class="o-page">P.{sub.pageNumber}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else if activeTab === "folder"}
      <div class="folder-browser">
        <div class="drive-bar">
          {#each drives as d}
            <button
              type="button"
              class="drive-btn"
              class:active={currentDir.toUpperCase().startsWith(d.toUpperCase())}
              onclick={() => onNavigateFolder(d)}
            >
              {d}
            </button>
          {/each}
        </div>

        <form
          class="path-form"
          onsubmit={(e) => {
            e.preventDefault();
            if (customPathInput.trim()) {
              onNavigateFolder(customPathInput.trim());
            }
          }}
        >
          <input
            type="text"
            class="path-input"
            bind:value={customPathInput}
            title="フォルダーパスを入力してEnterで移動"
          />
        </form>

        <div class="folder-list">
          {#if parentDir}
            <button
              type="button"
              class="folder-row dir-row"
              onclick={() => parentDir && onNavigateFolder(parentDir)}
            >
              <span class="f-icon">📁</span>
              <span class="f-name">.. (親フォルダーへ)</span>
            </button>
          {/if}

          {#each folderEntries as entry (entry.path)}
            {#if entry.is_dir}
              <button
                type="button"
                class="folder-row dir-row"
                onclick={() => onNavigateFolder(entry.path)}
              >
                <span class="f-icon">📁</span>
                <span class="f-name" title={entry.name}>{entry.name}</span>
              </button>
            {:else}
              <div
                class="folder-row pdf-row"
                class:active={activeFilePath.toLowerCase() === entry.path.toLowerCase()}
              >
                <button
                  type="button"
                  class="pdf-open-btn"
                  onclick={() => onOpenPdfFile(entry.path)}
                  title="{entry.name} を開く ({formatBytes(entry.size_bytes)})"
                >
                  <span class="f-icon">📄</span>
                  <div class="f-info">
                    <div class="f-name">{entry.name}</div>
                    <div class="f-meta">{formatBytes(entry.size_bytes)} · {entry.modified}</div>
                  </div>
                </button>
                <button
                  type="button"
                  class="quick-merge-btn"
                  title="このPDFを結合リストに追加"
                  onclick={() => onQuickAddMergePdf(entry.path)}
                >
                  +結合
                </button>
              </div>
            {/if}
          {/each}

          {#if folderEntries.length === 0}
            <div class="empty-msg">このフォルダー内にPDFファイルはありません</div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</aside>

<style>
  .sidebar-panel {
    width: 245px;
    min-width: 245px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--ui-panel-bg);
    border-right: 1px solid var(--ui-border);
    overflow: hidden;
  }

  .sidebar-tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid var(--ui-border);
    background: var(--nord0);
  }

  .s-tab {
    padding: 6px 2px;
    font-size: 11px;
    text-align: center;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--ui-fg);
    white-space: nowrap;
  }

  .s-tab:hover {
    background: var(--ui-hover-bg);
    color: var(--ui-fg-bright);
  }

  .s-tab.active {
    border-bottom-color: var(--ui-accent);
    color: var(--ui-accent);
    font-weight: 700;
    background: var(--ui-panel-bg);
  }

  .sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .thumb-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .empty-msg {
    padding: 20px 10px;
    text-align: center;
    color: var(--nord3);
    font-size: 12px;
    line-height: 1.5;
  }

  .ann-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 11px;
    color: var(--nord4);
  }

  .clear-all-btn {
    padding: 2px 6px;
    font-size: 11px;
    border: 1px solid var(--ui-border);
    color: var(--ui-danger);
  }

  .ann-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ann-item {
    padding: 6px 8px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    cursor: pointer;
  }

  .ann-item:hover {
    border-color: var(--ui-accent);
  }

  .ann-item-top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }

  .ann-page-badge {
    font-weight: 700;
    color: var(--ui-accent);
  }

  .ann-color-chip {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .ann-kind-text {
    flex: 1;
    font-weight: 600;
  }

  .ann-del-btn {
    padding: 0 5px;
    color: var(--nord3);
  }

  .ann-del-btn:hover {
    color: var(--ui-danger);
  }

  .ann-text-preview {
    margin-top: 4px;
    font-size: 11px;
    color: var(--ui-fg-bright);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .outline-tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .outline-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 6px;
    text-align: left;
    font-size: 12px;
  }

  .outline-btn:hover:not(:disabled) {
    background: var(--ui-hover-bg);
    color: var(--ui-accent);
  }

  .outline-btn.sub {
    padding-left: 16px;
    font-size: 11px;
  }

  .o-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .o-page {
    font-size: 10px;
    color: var(--nord3);
    margin-left: 6px;
  }

  .folder-browser {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .drive-bar {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .drive-btn {
    padding: 2px 6px;
    font-size: 11px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
  }

  .drive-btn.active {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
    font-weight: 700;
  }

  .path-form {
    width: 100%;
  }

  .path-input {
    width: 100%;
    font-size: 11px;
    padding: 3px 6px;
  }

  .folder-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .folder-row {
    display: flex;
    align-items: center;
    width: 100%;
    border-radius: 3px;
    background: var(--nord0);
    border: 1px solid transparent;
  }

  .dir-row {
    padding: 5px 6px;
    gap: 6px;
    text-align: left;
    font-size: 12px;
  }

  .dir-row:hover {
    background: var(--ui-hover-bg);
    border-color: var(--ui-border);
  }

  .pdf-row {
    padding: 3px 4px;
    justify-content: space-between;
  }

  .pdf-row.active {
    border-color: var(--ui-accent);
    background: rgba(136, 192, 208, 0.12);
  }

  .pdf-open-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 2px;
  }

  .f-info {
    flex: 1;
    min-width: 0;
  }

  .f-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-fg-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .f-meta {
    font-size: 10px;
    color: var(--nord3);
  }

  .quick-merge-btn {
    padding: 2px 5px;
    font-size: 10px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
    color: var(--ui-accent);
    white-space: nowrap;
  }

  .quick-merge-btn:hover {
    background: var(--ui-accent);
    color: #111827;
  }
</style>
