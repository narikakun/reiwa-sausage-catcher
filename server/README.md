# ランキングAPI

ゲーム本体は GitHub Pages、このフォルダの PHP と MySQL だけをレンタルサーバーに置きます。画像などのファイルはサーバーに保存しません。

## 構成

| ファイル | 役割 |
| --- | --- |
| `public/start.php` | POST。ゲーム開始時に使い捨てのプレイトークンを発行 |
| `public/score.php` | POST `{token, playerKey, score, sausages, name?}`。ゲーム終了時に自動で記録。同じプレイヤーは1人1件で、ベストを超えたときだけ更新し、総合・今日の順位とベストを返す。初めてのプレイヤーで名前がない・使えない場合は `default_name` |
| `public/name.php` | POST `{playerKey, name}`。そのプレイヤーの名前を登録・変更（ランキングの表示名がすべて変わる） |
| `public/ranking.php` | GET `?period=all` または `?period=today`。上位50件 |
| `public/lib/bootstrap.php` | DB接続・CORS・回数制限などの共通処理 |
| `public/lib/config.sample.php` | 設定のひな形（`config.php` にコピーして使う） |
| `schema.sql` | テーブル作成SQL |

## 設置手順

1. **データベースを作る**
   レンタルサーバーのコントロールパネルで、MySQL のデータベースとユーザーを作ります。
2. **テーブルを作る**
   phpMyAdmin で作ったデータベースを開き、「SQL」タブに `schema.sql` の中身を貼って実行します。
   1ゲーム1件だった以前のバージョンでテーブルを作成済みの場合は、先に `schema.sql` 末尾の `DROP TABLE IF EXISTS sausage_scores;`（コメントを外したもの）を実行してから、全体を実行してください。以前の記録は消えます。
3. **設定ファイルを作る**
   `public/lib/config.sample.php` を `public/lib/config.php` にコピーし、次を書き換えます。
   - `db`：手順1のホスト名・データベース名・ユーザー名・パスワード（ホスト名はコントロールパネルに表示されるもの）
   - `allowed_origins`：ゲームのURL（`https://reiwa-sausage-catcher.nakn.jp`）。ローカルで試すときは `http://localhost:8080` なども追加
   - `secret`：長いランダムな文字列（例：`php -r "echo bin2hex(random_bytes(32));"` の出力）
   - `ng_words`：名前に使わせたくない言葉
4. **アップロード**
   `public/` の中身（`.htaccess` と `lib/.htaccess` も含む）を、公開したい場所にアップロードします。
   例：`https://api.example.com/sausage/` で公開するなら、そのドメインの公開フォルダに `sausage/` を作って中に置きます。
5. **ゲーム側にURLを設定**
   `main.js` 冒頭の `RANKING_API` に、手順4のURLを末尾の `/` なしで書きます（例：`https://api.example.com/sausage`）。空のままだとランキング機能は表示されません。
6. **動作確認**
   ブラウザで `…/ranking.php` を開き、`{"period":"all","entries":[]}` が返ればOKです。`lib/config.php` を直接開いて 403 になることも確認してください。

## 不正対策と制限

ゲームはブラウザで動いているため、改造したクライアントからの送信を完全には防げません。次の範囲で、ありえない記録をはじきます。

- スコアは 1本につき50点（GOOD）か100点（PERFECT）なので、`本数×50 ≦ スコア ≦ 本数×100` かつ 50 の倍数のみ受け付けます。
- `start.php` のトークンは1回だけ使えます。開始からの経過時間が「本数×1.5秒」未満、または6時間を超える記録は拒否します。
- 同じ接続元からの送信は、開始が10分に60回、登録が10分に10回までです。IPアドレスはそのまま保存せず、`secret` 付きのハッシュだけを保存します。
- 名前は1〜10文字。制御文字を除き、`ng_words` を含む名前は拒否します。
- 同じ人かどうかは、ブラウザに保存したランダムな `playerKey` で見分けます。サーバーには `playerKey` そのものではなくハッシュだけを保存するので、名前を変えられるのはそのブラウザのプレイヤーだけです。ブラウザのデータを消したり別の端末で遊んだりすると、別のプレイヤーになります。名前変更は10分に20回までです。
- ランキングには各プレイヤーのベストだけを載せます（`sausage_bests`）。全ゲームの記録は `sausage_scores` に残ります。今日のランキング用のベストは30日分だけ残します。
- 「今日」は日本時間の0時で切り替わります。
