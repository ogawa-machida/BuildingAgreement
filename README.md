# 小川１・２丁目地区環境を守る会 建築協約受付 v0.1

## 公開準備

1. GitHub の `ogawa-machida/BuildingAgreement` に、このフォルダーの中身を置きます。Settings → Pages で、公開元を main ブランチの `/docs` に設定します。公開先は https://ogawa-machida.github.io/BuildingAgreement/ です。会の画面は同じURLの末尾に `admin.html` を付けます。
2. Firebase プロジェクト `buildingagreement-9ee19` の Authentication で「匿名」と「メール/パスワード」を有効にします。承認済みドメインに `ogawa-machida.github.io` を追加します。Realtime Database の接続先は `https://buildingagreement-9ee19-default-rtdb.asia-southeast1.firebasedatabase.app` です。
3. reCAPTCHA Enterprise のウェブサイトキーに公開ドメインを登録し、Firebase App Check で提供済みのWebアプリに紐付けます。公開キーを `docs/config.mjs` の `appCheckSiteKey` に設定し、テスト後に Cloud Storage の App Check を強制します。Cloud Functions は App Check を必須にしています。Cloud Functions・Storageのために Blaze プランが必要です。
4. Cloud Storage のバケットを有効化し、公開ドメインから管理画面でPDFを取得できるように CORS を設定します。`gcloud storage buckets update gs://buildingagreement-9ee19.firebasestorage.app --cors-file=storage-cors.json`。別の公開ドメインを利用する場合はこの設定も更新します。
5. Firebase CLI で権限のあるアカウントにログインします。Node.js 22 で `npm --prefix functions install` の後、`firebase deploy --only database,storage,functions --project buildingagreement-9ee19` を実行します。この操作は当該プロジェクトの Database/Storage Rules を置き換えます。
6. 会長用のメールアドレスで Authentication ユーザーを作成し、Application Default Credentials を設定した管理者環境で `node functions/grant-admin.mjs 管理者メールアドレス` を実行します。前任者の権限を外す場合は末尾に `revoke` を追加します。退任時に即時停止が必要な場合は Firebase Authentication でアカウントも無効化します。

## 対象区域の確認

提供されたWKTの座標を基に、地図に対象区域の境界を表示します。建築予定地が境界付近にある、または敷地が区域をまたぐ場合は、質問・事前相談をご利用ください。

## 動作確認

`python3 -m http.server 8000 --directory docs` で画面・原本PDF・区域図を確認できます。公開設定が空の状態ではフォームを送信できません。

本番の公開前に、テストデータで質問のみ、一括PDF、個別PDF、境界付近、会長の閲覧・図面取得・回答状況の更新を確認します。異なるアカウントから申請内容や他人の図面を読み取れないことも確認します。申請者には画面で受付番号を表示し、回答は会長が管理画面のメールリンクから送ります。申請者への自動メール送信、再提出リンク、図面の保管期間を適用する自動削除は本版の対象外です。試験で中断したアップロードが残った場合は、案件の図面参照パスと照合してから Storage で削除します。公開する協約書・対象区域図は掲載可否を確認してください。

## 建築承認願いの管理者メール通知

Realtime Database の `cases` に新しい建築承認願いが保存されると、Resend を使って管理者に受付番号と管理画面URLを送ります。質問・事前相談は通知対象外です。本文には申請者の個人情報や図面を含めません。

1. Resendで本番の差出人ドメインを認証し、送信専用のAPIキーを発行します。
2. `functions/.env.buildingagreement-9ee19` に以下の２行を設定します。値は管理する実際のメールアドレスに置き換えてください。このファイルはGitHubにアップロードしません。

   ```dotenv
   AGREEMENT_MAIL_FROM=notice@your-verified-domain.example
   AGREEMENT_ADMIN_EMAIL=your-admin@example.com
   ```

3. プロジェクトのルートで以下を実行します。APIキーはコマンドが表示する入力欄に貼り付けます。

   ```powershell
   npm --prefix functions install
   npx firebase-tools functions:secrets:set RESEND_API_KEY --project buildingagreement-9ee19
   npx firebase-tools deploy --only functions --project buildingagreement-9ee19
   ```

4. テスト用の建築承認願いを１件送信し、管理者の受信箱と会の管理画面を確認します。通知の成否は申請の保存結果に影響しません。通知が届かない場合は `notifyNewApplication` のログとResendの送信履歴を確認してください。
