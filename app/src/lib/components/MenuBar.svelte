<script lang="ts">
  import type { ToolMode, ViewLayoutMode } from "../types";

  interface MenuEntry {
    id: string;
    label?: string;
    shortcut?: string;
    checked?: boolean;
    disabled?: boolean;
    separator?: boolean;
    colorDot?: string;
    action?: () => void;
  }

  interface MenuGroup {
    id: string;
    title: string;
    accessKey: string;
    items: MenuEntry[];
  }

  interface Props {
    fileName: string;
    isModified: boolean;
    hasPdf: boolean;
    sidebarOpen: boolean;
    pageBarOpen: boolean;
    annotationBarOpen: boolean;
    searchOpen: boolean;
    layoutMode: ViewLayoutMode;
    currentPage: number;
    totalPages: number;
    zoomScale: number;
    toolMode: ToolMode;
    activeColor: string;
    canUndo: boolean;
    canRedo: boolean;
    selectedCount: number;
    themeSetting: string;
    onToggleSidebar: () => void;
    onTogglePageBar: () => void;
    onToggleAnnotationBar: () => void;
    onToggleSearch: () => void;
    onChangeLayout: (mode: ViewLayoutMode) => void;
    onGoToPage: (page: number) => void;
    onChangeZoom: (newScale: number) => void;
    onFitWidth: () => void;
    onFitPage: () => void;
    onChangeTool: (tool: ToolMode) => void;
    onChangeColor: (color: string) => void;
    onUndo: () => void;
    onRedo: () => void;
    onSaveAs: () => void;
    onSaveOverwrite: () => void;
    onOpenExtractModal: () => void;
    onOpenSplitModal: () => void;
    onOpenMergeModal: () => void;
    onRotateSelectedOrCurrent: (delta: number) => void;
    onDeleteSelectedPages: () => void;
    onToggleCurrentPageSelect: () => void;
    onSelectPreset: (
      preset: "all" | "none" | "invert" | "odd" | "even" | "from_current" | "to_current"
    ) => void;
    onClearAllAnnotations: () => void;
    onOpenFolderTab: () => void;
    onChangeTheme: (theme: string) => void;
    onOpenHelp: () => void;
  }

  let {
    fileName,
    isModified,
    hasPdf,
    sidebarOpen,
    pageBarOpen,
    annotationBarOpen,
    searchOpen,
    layoutMode,
    currentPage,
    totalPages,
    zoomScale,
    toolMode,
    activeColor,
    canUndo,
    canRedo,
    selectedCount,
    themeSetting,
    onToggleSidebar,
    onTogglePageBar,
    onToggleAnnotationBar,
    onToggleSearch,
    onChangeLayout,
    onGoToPage,
    onChangeZoom,
    onFitWidth,
    onFitPage,
    onChangeTool,
    onChangeColor,
    onUndo,
    onRedo,
    onSaveAs,
    onSaveOverwrite,
    onOpenExtractModal,
    onOpenSplitModal,
    onOpenMergeModal,
    onRotateSelectedOrCurrent,
    onDeleteSelectedPages,
    onToggleCurrentPageSelect,
    onSelectPreset,
    onClearAllAnnotations,
    onOpenFolderTab,
    onChangeTheme,
    onOpenHelp,
  }: Props = $props();

  let openMenuId = $state<string | null>(null);
  let pageInputStr = $state("");

  $effect(() => {
    pageInputStr = String(currentPage);
  });

  function commitPageJump() {
    const n = Number.parseInt(pageInputStr, 10);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) {
      onGoToPage(n);
    } else {
      pageInputStr = String(currentPage);
    }
  }

  function closeMenus() {
    openMenuId = null;
  }

  function runMenuAction(entry: MenuEntry) {
    if (entry.disabled || !entry.action) return;
    closeMenus();
    entry.action();
  }

  const menus = $derived<MenuGroup[]>([
    {
      id: "file",
      title: "ファイル",
      accessKey: "F",
      items: [
        {
          id: "open-folder-tab",
          label: "フォルダーパネルからPDFを開く...",
          shortcut: "Ctrl+B",
          action: onOpenFolderTab,
        },
        { id: "sep-f1", separator: true },
        {
          id: "save-as",
          label: "別名で保存 (推奨)...",
          shortcut: "Ctrl+S",
          disabled: !hasPdf,
          action: onSaveAs,
        },
        {
          id: "save-overwrite",
          label: "元ファイルに上書き保存...",
          shortcut: "Ctrl+Shift+S",
          disabled: !hasPdf,
          action: onSaveOverwrite,
        },
        { id: "sep-f2", separator: true },
        {
          id: "file-extract",
          label: "指定ページを抽出して保存...",
          disabled: !hasPdf,
          action: onOpenExtractModal,
        },
        {
          id: "file-split",
          label: "PDFを複数ファイルに分割...",
          disabled: !hasPdf,
          action: onOpenSplitModal,
        },
        {
          id: "file-merge",
          label: "複数のPDFファイルを結合...",
          action: onOpenMergeModal,
        },
      ],
    },
    {
      id: "edit",
      title: "編集",
      accessKey: "E",
      items: [
        {
          id: "undo",
          label: "元に戻す",
          shortcut: "Ctrl+Z",
          disabled: !canUndo,
          action: onUndo,
        },
        {
          id: "redo",
          label: "やり直す",
          shortcut: "Ctrl+Y",
          disabled: !canRedo,
          action: onRedo,
        },
        { id: "sep-e1", separator: true },
        {
          id: "find",
          label: "PDF内テキスト検索",
          shortcut: "Ctrl+F",
          checked: searchOpen,
          disabled: !hasPdf,
          action: onToggleSearch,
        },
        { id: "sep-e2", separator: true },
        {
          id: "sel-cur",
          label: `現在ページ (P.${currentPage}) を選択/解除`,
          shortcut: "Space",
          disabled: !hasPdf,
          action: onToggleCurrentPageSelect,
        },
        {
          id: "sel-all",
          label: "全ページを選択 (all)",
          disabled: !hasPdf,
          action: () => onSelectPreset("all"),
        },
        {
          id: "sel-none",
          label: "ページ選択をすべて解除",
          disabled: !hasPdf || selectedCount === 0,
          action: () => onSelectPreset("none"),
        },
        {
          id: "sel-invert",
          label: "ページ選択を反転",
          disabled: !hasPdf,
          action: () => onSelectPreset("invert"),
        },
        {
          id: "sel-odd",
          label: "奇数ページのみ選択 (odd)",
          disabled: !hasPdf,
          action: () => onSelectPreset("odd"),
        },
        {
          id: "sel-even",
          label: "偶数ページのみ選択 (even)",
          disabled: !hasPdf,
          action: () => onSelectPreset("even"),
        },
        {
          id: "sel-from-cur",
          label: `現在ページ (P.${currentPage}) から末尾までを選択`,
          disabled: !hasPdf,
          action: () => onSelectPreset("from_current"),
        },
      ],
    },
    {
      id: "view",
      title: "表示",
      accessKey: "V",
      items: [
        {
          id: "toggle-sidebar",
          label: "左サイドパネルを表示",
          shortcut: "Ctrl+B",
          checked: sidebarOpen,
          action: onToggleSidebar,
        },
        {
          id: "toggle-pagebar",
          label: "ページ操作・番号指定バーを表示",
          shortcut: "F2",
          checked: pageBarOpen,
          action: onTogglePageBar,
        },
        {
          id: "toggle-annbar",
          label: "注釈ツールバーを表示",
          shortcut: "F3",
          checked: annotationBarOpen,
          action: onToggleAnnotationBar,
        },
        { id: "sep-v1", separator: true },
        {
          id: "layout-continuous",
          label: "連続スクロール表示",
          checked: layoutMode === "continuous",
          disabled: !hasPdf,
          action: () => onChangeLayout("continuous"),
        },
        {
          id: "layout-single",
          label: "単一ページ表示",
          checked: layoutMode === "single",
          disabled: !hasPdf,
          action: () => onChangeLayout("single"),
        },
        {
          id: "layout-grid",
          label: "一覧グリッド表示 (サムネイル整理)",
          checked: layoutMode === "grid",
          disabled: !hasPdf,
          action: () => onChangeLayout("grid"),
        },
        { id: "sep-v2", separator: true },
        {
          id: "zoom-in",
          label: "拡大 (ズームイン)",
          shortcut: "Ctrl++",
          disabled: !hasPdf,
          action: () => onChangeZoom(zoomScale + 0.15),
        },
        {
          id: "zoom-out",
          label: "縮小 (ズームアウト)",
          shortcut: "Ctrl+-",
          disabled: !hasPdf,
          action: () => onChangeZoom(zoomScale - 0.15),
        },
        {
          id: "fit-width",
          label: "ウィンドウ幅に合わせる",
          shortcut: "W",
          disabled: !hasPdf,
          action: onFitWidth,
        },
        {
          id: "fit-page",
          label: "1ページ全体に合わせる",
          shortcut: "F",
          disabled: !hasPdf,
          action: onFitPage,
        },
        { id: "sep-v3", separator: true },
        {
          id: "theme-guif",
          label: "テーマ: guif連携 (config.toml)",
          checked: themeSetting === "guif",
          action: () => onChangeTheme("guif"),
        },
        {
          id: "theme-nord",
          label: "テーマ: Nord",
          checked: themeSetting === "nord",
          action: () => onChangeTheme("nord"),
        },
        {
          id: "theme-default",
          label: "テーマ: Default",
          checked: themeSetting === "default",
          action: () => onChangeTheme("default"),
        },
        {
          id: "theme-catppuccin",
          label: "テーマ: Catppuccin",
          checked: themeSetting === "catppuccin",
          action: () => onChangeTheme("catppuccin"),
        },
        {
          id: "theme-monokai",
          label: "テーマ: Monokai",
          checked: themeSetting === "monokai",
          action: () => onChangeTheme("monokai"),
        },
        {
          id: "theme-solarized",
          label: "テーマ: Solarized",
          checked: themeSetting === "solarized",
          action: () => onChangeTheme("solarized"),
        },
        {
          id: "theme-light",
          label: "テーマ: Light",
          checked: themeSetting === "light",
          action: () => onChangeTheme("light"),
        },
      ],
    },
    {
      id: "page",
      title: "ページ操作",
      accessKey: "P",
      items: [
        {
          id: "p-toggle-bar",
          label: "ページ番号指定・操作バーを展開/折りたたみ",
          shortcut: "F2",
          checked: pageBarOpen,
          action: onTogglePageBar,
        },
        { id: "sep-p1", separator: true },
        {
          id: "p-rot-right",
          label: "右に90°回転 (選択または現在ページ)",
          shortcut: "R",
          disabled: !hasPdf,
          action: () => onRotateSelectedOrCurrent(90),
        },
        {
          id: "p-rot-left",
          label: "左に90°回転 (選択または現在ページ)",
          shortcut: "Shift+R",
          disabled: !hasPdf,
          action: () => onRotateSelectedOrCurrent(-90),
        },
        {
          id: "p-rot-180",
          label: "180°回転 (選択または現在ページ)",
          disabled: !hasPdf,
          action: () => onRotateSelectedOrCurrent(180),
        },
        { id: "sep-p2", separator: true },
        {
          id: "p-delete",
          label:
            selectedCount > 0
              ? `選択中の ${selectedCount} ページを削除`
              : `現在ページ (P.${currentPage}) を削除`,
          disabled: !hasPdf,
          action: onDeleteSelectedPages,
        },
        { id: "sep-p3", separator: true },
        {
          id: "p-extract",
          label: "ページ抽出 (番号・範囲指定)...",
          disabled: !hasPdf,
          action: onOpenExtractModal,
        },
        {
          id: "p-split",
          label: "PDF分割 (範囲・区切り位置・均等)...",
          disabled: !hasPdf,
          action: onOpenSplitModal,
        },
        {
          id: "p-merge",
          label: "PDF結合 (複数ファイル・ページ範囲指定)...",
          action: onOpenMergeModal,
        },
      ],
    },
    {
      id: "annotation",
      title: "注釈",
      accessKey: "A",
      items: [
        {
          id: "a-toggle-bar",
          label: "注釈ツールバーを展開/折りたたみ",
          shortcut: "F3",
          checked: annotationBarOpen,
          action: onToggleAnnotationBar,
        },
        { id: "sep-a1", separator: true },
        {
          id: "tool-select",
          label: "選択・移動モード",
          shortcut: "V",
          checked: toolMode === "select",
          disabled: !hasPdf,
          action: () => onChangeTool("select"),
        },
        {
          id: "tool-highlight",
          label: "ハイライト (文字選択 / 矩形範囲)",
          shortcut: "H",
          checked: toolMode === "highlight",
          disabled: !hasPdf,
          action: () => onChangeTool("highlight"),
        },
        {
          id: "tool-text",
          label: "文字記入 (日本語テキスト追加)",
          shortcut: "T",
          checked: toolMode === "text",
          disabled: !hasPdf,
          action: () => onChangeTool("text"),
        },
        {
          id: "tool-sticky",
          label: "付箋メモ追加",
          shortcut: "N",
          checked: toolMode === "sticky",
          disabled: !hasPdf,
          action: () => onChangeTool("sticky"),
        },
        {
          id: "tool-rect",
          label: "四角枠描画",
          shortcut: "B",
          checked: toolMode === "rect",
          disabled: !hasPdf,
          action: () => onChangeTool("rect"),
        },
        {
          id: "tool-arrow",
          label: "矢印描画",
          shortcut: "A",
          checked: toolMode === "arrow",
          disabled: !hasPdf,
          action: () => onChangeTool("arrow"),
        },
        {
          id: "tool-line",
          label: "直線描画",
          shortcut: "L",
          checked: toolMode === "line",
          disabled: !hasPdf,
          action: () => onChangeTool("line"),
        },
        {
          id: "tool-pen",
          label: "手書きペン描画",
          shortcut: "P",
          checked: toolMode === "pen",
          disabled: !hasPdf,
          action: () => onChangeTool("pen"),
        },
        { id: "sep-a2", separator: true },
        {
          id: "col-yellow",
          label: "色: イエロー",
          colorDot: "#facc15",
          checked: activeColor === "#facc15",
          action: () => onChangeColor("#facc15"),
        },
        {
          id: "col-green",
          label: "色: グリーン",
          colorDot: "#4ade80",
          checked: activeColor === "#4ade80",
          action: () => onChangeColor("#4ade80"),
        },
        {
          id: "col-cyan",
          label: "色: シアン",
          colorDot: "#38bdf8",
          checked: activeColor === "#38bdf8",
          action: () => onChangeColor("#38bdf8"),
        },
        {
          id: "col-pink",
          label: "色: ピンク",
          colorDot: "#f472b6",
          checked: activeColor === "#f472b6",
          action: () => onChangeColor("#f472b6"),
        },
        {
          id: "col-red",
          label: "色: レッド",
          colorDot: "#ef4444",
          checked: activeColor === "#ef4444",
          action: () => onChangeColor("#ef4444"),
        },
        { id: "sep-a3", separator: true },
        {
          id: "clear-anns",
          label: "全ページの注釈をすべて消去",
          disabled: !hasPdf,
          action: onClearAllAnnotations,
        },
      ],
    },
    {
      id: "help",
      title: "ヘルプ",
      accessKey: "H",
      items: [
        {
          id: "help-shortcuts",
          label: "ショートカットキー＆ページ指定書式一覧...",
          shortcut: "?",
          action: onOpenHelp,
        },
      ],
    },
  ]);

  function handleWindowClick(e: MouseEvent) {
    if (!openMenuId) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".menubar-root")) {
      closeMenus();
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && openMenuId) {
      openMenuId = null;
      return;
    }
    // Alt+F / Alt+E / Alt+V / Alt+P / Alt+A / Alt+H access keys (without Ctrl/Meta)
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toUpperCase();
      const found = menus.find((m) => m.accessKey === k);
      if (found) {
        e.preventDefault();
        openMenuId = openMenuId === found.id ? null : found.id;
      }
    }
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeyDown} />

<div class="menubar-root" role="menubar" aria-label="メインメニュー">
  <!-- Left: Classic Menu Headings -->
  <div class="menu-headings">
    {#each menus as menu (menu.id)}
      <div class="menu-slot">
        <button
          type="button"
          class="menu-heading-btn"
          class:open={openMenuId === menu.id}
          onclick={() => (openMenuId = openMenuId === menu.id ? null : menu.id)}
          onmouseenter={() => {
            if (openMenuId !== null) openMenuId = menu.id;
          }}
        >
          {menu.title}(<span class="accel">{menu.accessKey}</span>)
        </button>

        {#if openMenuId === menu.id}
          <div class="menu-dropdown" role="menu">
            {#each menu.items as item (item.id)}
              {#if item.separator}
                <div class="menu-sep" role="separator"></div>
              {:else}
                <button
                  type="button"
                  class="menu-item-btn"
                  disabled={item.disabled}
                  onclick={() => runMenuAction(item)}
                >
                  <span class="item-check">
                    {#if item.checked}✓{/if}
                  </span>
                  {#if item.colorDot}
                    <span
                      class="item-color-dot"
                      style="background: {item.colorDot};"
                    ></span>
                  {/if}
                  <span class="item-label">{item.label}</span>
                  {#if item.shortcut}
                    <span class="item-shortcut">{item.shortcut}</span>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Center: Slim inline page & zoom controls when viewing a PDF -->
  {#if hasPdf}
    <div class="inline-nav-strip">
      <button
        type="button"
        class="inline-btn"
        disabled={currentPage <= 1}
        title="前のページ (PageUp / K)"
        onclick={() => onGoToPage(currentPage - 1)}
      >
        ◀
      </button>
      <input
        type="text"
        class="inline-page-input"
        bind:value={pageInputStr}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitPageJump();
          }
        }}
        onblur={commitPageJump}
      />
      <span class="inline-total">/ {totalPages}</span>
      <button
        type="button"
        class="inline-btn"
        disabled={currentPage >= totalPages}
        title="次のページ (PageDown / J)"
        onclick={() => onGoToPage(currentPage + 1)}
      >
        ▶
      </button>

      <span class="strip-sep">|</span>

      <button
        type="button"
        class="inline-btn"
        title="縮小 (Ctrl+-)"
        onclick={() => onChangeZoom(zoomScale - 0.15)}
      >
        −
      </button>
      <span class="inline-zoom">{Math.round(zoomScale * 100)}%</span>
      <button
        type="button"
        class="inline-btn"
        title="拡大 (Ctrl++)"
        onclick={() => onChangeZoom(zoomScale + 0.15)}
      >
        ＋
      </button>
    </div>
  {/if}

  <!-- Right: Collapsible Toolbar Toggles & File Indicator -->
  <div class="menubar-right">
    {#if fileName}
      <span class="mini-filename" title={fileName}>
        {fileName}{isModified ? " ●" : ""}
      </span>
    {/if}

    <button
      type="button"
      class="drawer-toggle-btn"
      class:expanded={pageBarOpen}
      title="ページ番号指定・操作バーを展開/折りたたむ (F2)"
      onclick={onTogglePageBar}
    >
      <span>📄 ページ操作</span>
      {#if selectedCount > 0}
        <span class="sel-pill">{selectedCount}</span>
      {/if}
      <span class="chevron">{pageBarOpen ? "▴" : "▾"}</span>
    </button>

    <button
      type="button"
      class="drawer-toggle-btn"
      class:expanded={annotationBarOpen}
      title="注釈・ハイライトツールバーを展開/折りたたむ (F3)"
      onclick={onToggleAnnotationBar}
    >
      <span>✎ 注釈ツール</span>
      {#if toolMode !== "select"}
        <span class="tool-pill">{toolMode}</span>
      {/if}
      <span class="chevron">{annotationBarOpen ? "▴" : "▾"}</span>
    </button>
  </div>
</div>

<style>
  .menubar-root {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 30px;
    padding: 0 8px;
    background: var(--ui-panel-bg);
    border-bottom: 1px solid var(--ui-border);
    font-size: 12px;
    user-select: none;
    z-index: 50;
  }

  .menu-headings {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .menu-slot {
    position: relative;
  }

  .menu-heading-btn {
    padding: 3px 8px;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--ui-fg);
    background: transparent;
    font-size: 12px;
    cursor: default;
  }

  .menu-heading-btn:hover,
  .menu-heading-btn.open {
    background: var(--ui-hover-bg);
    color: var(--ui-fg-bright);
    border-color: var(--ui-border);
  }

  .menu-heading-btn.open {
    border-color: var(--ui-accent);
    font-weight: 700;
  }

  .accel {
    text-decoration: underline;
  }

  .menu-dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    min-width: 265px;
    padding: 4px 0;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-accent);
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    z-index: 200;
    display: flex;
    flex-direction: column;
  }

  .menu-sep {
    height: 1px;
    margin: 4px 0;
    background: var(--ui-border);
  }

  .menu-item-btn {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 5px 12px;
    text-align: left;
    border: none;
    border-radius: 0;
    font-size: 12px;
    color: var(--ui-fg-bright);
    gap: 6px;
  }

  .menu-item-btn:hover:not(:disabled) {
    background: var(--ui-accent);
    color: #111827;
    font-weight: 600;
  }

  .menu-item-btn:hover:not(:disabled) .item-shortcut {
    color: #1f2937;
  }

  .item-check {
    width: 14px;
    text-align: center;
    font-weight: 700;
  }

  .item-color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .item-label {
    flex: 1;
    white-space: nowrap;
  }

  .item-shortcut {
    margin-left: 16px;
    font-size: 11px;
    color: var(--nord4);
    white-space: nowrap;
  }

  .inline-nav-strip {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .inline-btn {
    padding: 1px 6px;
    font-size: 11px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
  }

  .inline-btn:hover:not(:disabled) {
    border-color: var(--ui-accent);
    color: var(--ui-fg-bright);
  }

  .inline-page-input {
    width: 42px;
    padding: 1px 4px;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
  }

  .inline-total,
  .inline-zoom {
    font-size: 11px;
    color: var(--ui-fg);
  }

  .inline-zoom {
    min-width: 38px;
    text-align: center;
  }

  .strip-sep {
    color: var(--ui-border);
    margin: 0 2px;
  }

  .menubar-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mini-filename {
    font-size: 11px;
    color: var(--nord4);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drawer-toggle-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    font-size: 11px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    color: var(--ui-fg);
  }

  .drawer-toggle-btn:hover {
    border-color: var(--ui-accent);
    color: var(--ui-fg-bright);
  }

  .drawer-toggle-btn.expanded {
    background: var(--nord2);
    border-color: var(--ui-accent);
    color: var(--ui-accent);
    font-weight: 700;
  }

  .sel-pill,
  .tool-pill {
    padding: 0 5px;
    border-radius: 8px;
    background: var(--ui-accent);
    color: #111827;
    font-size: 10px;
    font-weight: 700;
  }

  .chevron {
    font-size: 10px;
    opacity: 0.8;
  }
</style>
