# Diner

Малко приложение за списък с манджи.

## Стартиране

```bash
npm install
```

Задай средата за Google вход:

```powershell
$env:GOOGLE_CLIENT_ID="твоя-google-oauth-client-id"
$env:SESSION_SECRET="дълга-случайна-стойност"
node server.js
```

След това отвори `http://localhost:3001`.

## Google настройка

Създай OAuth 2.0 Web Client в Google Cloud Console и добави `http://localhost:3001` в Authorized JavaScript origins.

## Съхранение на данни

Приложението поддържа два режима:

1. Firestore (препоръчително за Render, данните се пазят между deploy-и).
2. Локални JSON файлове в `data/users` (fallback, подходящо за локална разработка).

### Firestore конфигурация

Задай следните env променливи (например в Render Environment):

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIRESTORE_COLLECTION` (по избор, default е `user_dishes`)

Важно: в `FIREBASE_PRIVATE_KEY` новите редове трябва да са escaped като `\n`.

Пример (PowerShell):

```powershell
$env:FIREBASE_PROJECT_ID="my-project-id"
$env:FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxxx@my-project-id.iam.gserviceaccount.com"
$env:FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

При първо влизане на нов потребител, ако има `data/dishes.json`, той се използва като начален шаблон и във Firestore.