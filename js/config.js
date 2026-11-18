// Cloud sign-in keys for the hosted app. Fill these in once and every visitor can connect
// without typing anything (Settings, Cloud sync can still override them on one device).
//
// Google Drive: Google Cloud console > APIs & Services > Credentials > OAuth client ID,
//   type "Web application", authorised JavaScript origin https://cocoasuite.github.io
//   (enable the Google Drive API for the project; the app only asks for drive.file access).
// Yandex Disk: oauth.yandex.ru > Create app > Web services, redirect URI
//   https://cocoasuite.github.io/CocoaNotes/ with the Yandex Disk "app folder" permission.
export const CONFIG = {
  version: '1.0.0',
  googleClientId: '',
  yandexClientId: ''
}
