# 開発に参加するには

不具合の報告と改善の提案は [Issues](https://github.com/Az-kijitra/guif-pdf/issues) へお願いします。セキュリティの問題は [SECURITY.md](SECURITY.md) を参照してください。

## 準備

必要なもの: Windows 10 / 11、Rust 1.90 以上、Node.js 22.18 以上、WebView2 ランタイム。

```powershell
cd app
npm install
npm run tauri dev
```

## 確認のコマンド

プルリクエストの前に、次がすべて通ることを確認してください。CI も同じものを実行します。

```powershell
cd app
npm test                  # 単体テスト (Vitest)
npm run check             # 型チェック (svelte-check, tsc)

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

### E2E テスト

実アプリを起動して確かめます。ウィンドウが短時間ずつ開くので、対話的なデスクトップで実行してください。CI では実行しません。保存や起動引数、キー操作を変えたときは手元で実行してください。

```powershell
npm run e2e:build         # debug ビルド（本番のフロントエンドと CSP を含む）
npm run e2e               # 全シナリオ
npm run e2e -- keys       # 名前に keys を含むシナリオだけ
```

利用者のデータには触れません。debug ビルドだけが読む環境変数 `GUIF_PDF_CONFIG_DIR` で設定フォルダーを一時フォルダーへ移し、`GUIF_PDF_E2E_FS_SCOPE` で書き込み先をテスト用フォルダーに限ります。両方の有効を確かめるまで入力を送らず、終了後に本物の設定フォルダーが変わっていないことを検査します。

## 構成

| 場所 | 内容 |
| :--- | :--- |
| `app/src/lib/pdfEngine.ts` | PDF の出力（保存、抽出、分割、結合、注釈の焼き込み） |
| `app/src/lib/pageRangeParser.ts` | ページ指定の解釈 |
| `app/src/lib/keyCommands.ts` | キーからコマンドへの対応 |
| `app/src/lib/annotationRotation.ts` | ページの回転に伴う注釈の座標変換 |
| `app/src/routes/+page.svelte` | 画面全体の状態と操作 |
| `app/src-tauri/src/lib.rs` | ファイルの読み書き、起動引数、設定 |
| `app/e2e/` | E2E テスト |
| `docs/specs/` | 変えるときに注意が必要な動作の仕様 |

## 守ること

- **PDF を壊さない。** `pdfEngine.ts` を変えたら、別のリーダー（テストでは PDF.js）で出力を読み直して確かめるテストを書いてください。入力を単に読み戻すだけでは、白紙の PDF も通ります。
- **仕様と一緒に変える。** [docs/specs/](docs/specs/) の動作を変えるときは、仕様とマニュアルも直してください。ショートカットの一覧は `npm test` で実装と照合します。
- **`guif` との取り決めを守る。** 起動引数と設定の読み方は [docs/specs/guif-integration.md](docs/specs/guif-integration.md) にあります。

## リリース

1. `tauri.conf.json`、`package.json`、`Cargo.toml` の版を上げ、`npm install` と `cargo check` でロックファイルを更新します。
2. `npm run notices` で `THIRD_PARTY_NOTICES.md` を更新し、`CHANGELOG.md` を書きます。
3. `npm run release:build` を実行します。版の一致を確かめてインストーラーを作り、パスと SHA-256 を表示します。
4. インストーラーをインストールし、[README](README.md) の手順で動作を確かめてから、タグを付けて公開します。
