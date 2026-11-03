<script lang="ts">
  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let copied = $state(false);

  const GUIF_CONFIG_SNIPPET = `[[external_apps]]
name = "guif-pdfで開く"
program = "%LOCALAPPDATA%\\\\guif-pdf\\\\guif-pdf.exe"
args = ["{dir}"]
args_for_file = ["{path}"]
key = "Ctrl+Alt+P"`;

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(GUIF_CONFIG_SNIPPET);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      // ignore
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose}>
  <div class="modal-card" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h3>⌨ ショートカットキー ＆ ページ番号指定書式 ＆ guif連携ガイド</h3>
      <button type="button" class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="modal-body">
      <section class="help-sec">
        <h4>1. ページ番号指定の書式（大量ページの高速・確実な指定）</h4>
        <table class="help-table">
          <tbody>
            <tr>
              <td><code>1, 3, 5-12</code></td>
              <td>1ページ目、3ページ目、および5〜12ページ目を指定</td>
            </tr>
            <tr>
              <td><code>10-</code> または <code>10-end</code></td>
              <td>10ページ目から最終ページまでを指定（<code>-5</code> は1〜5ページ）</td>
            </tr>
            <tr>
              <td><code>all</code> / <code>odd</code> / <code>even</code></td>
              <td>全ページ / 奇数ページのみ / 偶数ページのみを指定</td>
            </tr>
            <tr>
              <td><code>1-50, !12, !20-25</code></td>
              <td>1〜50ページのうち、12ページ目と20〜25ページ目を<strong>除外</strong></td>
            </tr>
            <tr>
              <td><code>!1</code></td>
              <td>先頭に <code>!</code> を書いた場合は「全ページからP.1(表紙)を除外」</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="help-sec">
        <h4>2. キーボードショートカット</h4>
        <div class="shortcut-grid">
          <div><kbd>J</kbd> / <kbd>↓</kbd> / <kbd>PageDown</kbd> : 次のページ</div>
          <div><kbd>K</kbd> / <kbd>↑</kbd> / <kbd>PageUp</kbd> : 前のページ</div>
          <div><kbd>Home</kbd> / <kbd>End</kbd> : 先頭 / 最終ページ</div>
          <div><kbd>Space</kbd> : 現在ページの選択チェック ON/OFF</div>
          <div><kbd>R</kbd> / <kbd>Shift+R</kbd> : 右90°回転 / 左90°回転</div>
          <div><kbd>V</kbd> / <kbd>H</kbd> / <kbd>T</kbd> / <kbd>N</kbd> : 選択 / ハイライト / 文字記入 / 付箋</div>
          <div><kbd>B</kbd> / <kbd>A</kbd> / <kbd>L</kbd> / <kbd>P</kbd> : 四角枠 / 矢印 / 直線 / ペン</div>
          <div><kbd>W</kbd> / <kbd>F</kbd> : 幅に合わせる / ページ全体に合わせる</div>
          <div><kbd>Ctrl+S</kbd> / <kbd>Ctrl+Shift+S</kbd> : 別名保存 / 上書き保存</div>
          <div><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> : 元に戻す / やり直し</div>
          <div><kbd>Ctrl+F</kbd> : PDF内テキスト検索</div>
          <div><kbd>Ctrl+B</kbd> : 左サイドパネル表示/非表示</div>
        </div>
      </section>

      <section class="help-sec">
        <h4>3. <code>guif</code> の <code>config.toml</code> 連携設定例</h4>
        <p class="sec-note">
          <code>guif</code> で <code>Ctrl+,</code> を押して <code>config.toml</code> を開き、以下を追加すると <code>Ctrl+Alt+P</code> や右クリックメニューから選択中のPDFまたはフォルダーを直接 <code>guif-pdf</code> で開けます。
        </p>
        <div class="code-wrap">
          <pre>{GUIF_CONFIG_SNIPPET}</pre>
          <button type="button" class="copy-btn" onclick={copySnippet}>
            {copied ? "✓ コピーしました" : "TOMLをコピー"}
          </button>
        </div>
      </section>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn-primary" onclick={onClose}>閉じる</button>
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
    max-width: 660px;
    max-height: 88vh;
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
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .help-sec h4 {
    margin: 0 0 6px 0;
    font-size: 13px;
    color: var(--ui-accent);
  }

  .help-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
  }

  .help-table td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--ui-border);
  }

  .help-table td:first-child {
    white-space: nowrap;
    font-weight: 700;
    color: var(--nord13);
    width: 180px;
  }

  .shortcut-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;
    font-size: 12px;
    background: var(--nord0);
    padding: 8px 10px;
    border: 1px solid var(--ui-border);
    border-radius: 4px;
  }

  kbd {
    padding: 1px 5px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
    border-radius: 3px;
    font-size: 11px;
    color: var(--ui-fg-bright);
  }

  .sec-note {
    margin: 0 0 6px 0;
    font-size: 11px;
    color: var(--ui-fg);
  }

  .code-wrap {
    position: relative;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    padding: 8px 10px;
  }

  .code-wrap pre {
    margin: 0;
    font-size: 11px;
    color: var(--nord14);
    overflow-x: auto;
  }

  .copy-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 3px 8px;
    font-size: 11px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
  }

  .copy-btn:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 10px 14px;
    background: var(--nord0);
    border-top: 1px solid var(--ui-border);
  }

  .btn-primary {
    padding: 5px 16px;
    background: var(--ui-accent);
    color: #111827;
    font-weight: 700;
  }
</style>
