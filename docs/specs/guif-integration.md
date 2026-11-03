# `guif` との連携

`guif` と `guif-pdf` は別々に配布するので、次の取り決めを変えるときは両方を確かめる。

| ID | 取り決め | 確かめるテスト |
| :--- | :--- | :--- |
| GUIF-1 | インストール先は `%LOCALAPPDATA%\guif-pdf\guif-pdf.exe`（`productName` と `mainBinaryName` から決まる） | `release-config.test.ts` |
| GUIF-2 | 起動引数の PDF を開く。フォルダーならそのフォルダーを表示する。PDF 以外のファイルならそのフォルダーを表示する。`-` で始まる引数と存在しないパスは無視する | `lib.rs` のテスト、E2E |
| GUIF-3 | README の設定例は `guif` の `[[external_apps]]` の形式に従い、既定の 4 つを含める | `lib.rs` の `readme_external_app_example_matches_guif_schema` |
| GUIF-4 | `%APPDATA%\dev.guif.app\config.toml` の `[theme]` の `preset`（`name`、`theme` も可）を読む。読み取りだけで、書き込まない | `lib.rs` のテスト |
| GUIF-5 | `guif` の設定の雛形を読める | `lib.rs` の `guif_sample_config_is_readable_and_sets_no_theme` |

## `guif` を更新するとき

`app/src-tauri/test-fixtures/guif-config.sample.toml` は、`guif` の `app/src-tauri/templates/config.sample.toml` の写しである。`guif` の雛形が変わったら写しを更新し、`cargo test` で確かめる。

`guif` は `[[external_apps]]` を 1 つでも書くと既定の 4 つを使わなくなる。既定の 4 つが変わったら、README の例も直す。
