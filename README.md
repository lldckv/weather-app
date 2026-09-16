# Прогноз погоды
## [Лаб 4 по курсу](https://github.com/elmosmokinweed/WEB2025Q26LB4)
### [Деплой](https://73764686.weather-app-22o.pages.dev)
Простое веб-приложение прогноза погоды на чистом HTML/CSS/JavaScript (без фреймворков).
Добавить город можно вводя название на русском/английском.


## Источники данных

- [Google Places](https://developers.google.com/maps/documentation/places/web-service/text-search) — API для поиска геометок городов при добавлении через ввод пользователем
- [Open-Meteo](https://open-meteo.com/) — API прогноза погоды, используется для получения данных о погоде по координатам

Так как для API Google требуется ключ, чтобы его использовать и не сливать открыто, он добавлен при деплое как секрет в Cloudflare.
