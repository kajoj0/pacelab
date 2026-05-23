# PaceLab

Personal endurance training app z AI coachem. React + Vite + Anthropic API.

Triathlon 1/4 Bydgoszcz 12.07.2026 — plan domyślny dostosowany do tego startu.

## Funkcje

- Dashboard z metrykami CTL/ATL/TSB/PMC (model TrainingPeaks/Banister)
- Plan makrocyklu 8 tygodni z kalendarzem i szczegółowymi protokołami treningów (z zakresami HR per sekcja)
- Import CSV/TCX/GPX z Garmin Connect
- Coach AI (Claude Sonnet 4)
- Dziennik z asystentem głosowym + analiza AI sugerująca konkretne zmiany w planie
- Eksport planu do Google Calendar (.ics + linki per trening)
- Combo days (cardio + siłka) z 3 wariantami sprzętu (siłownia / dom / wyjazd)
- Pominięcie dnia z notatką (override planu)
- Manualne dodawanie treningów (siłka, basen bez zegarka)
- Zakładka Wiedza z pełnym wyjaśnieniem TSS/CTL/ATL/TSB
- Wszystkie dane lokalnie w przeglądarce (localStorage)

---

## 🚀 Uruchomienie lokalne (Windows, 5 minut)

### Krok 1: Zainstaluj Node.js

Wejdź na https://nodejs.org → pobierz wersję **LTS** (zielony przycisk po lewej) → uruchom plik .msi → klikaj Next/Install/Finish.

Po instalacji **zamknij wszystkie terminale** i otwórz nowy. Sprawdź: w cmd wpisz `node --version`. Powinno pokazać coś typu `v20.x.x`.

### Krok 2: Otwórz folder w terminalu

1. Rozpakuj ten ZIP gdziekolwiek (np. Pulpit)
2. Otwórz Eksplorator plików, wejdź do folderu `pacelab`
3. W pasku adresu (góra) wpisz `cmd` zamiast ścieżki i naciśnij Enter
4. Otworzy się terminal już w folderze pacelab

### Krok 3: Wklej klucz API

W terminalu:

```
copy .env.example .env
notepad .env
```

W Notatniku zamień prawą stronę `=` na swój prawdziwy klucz z console.anthropic.com (zaczyna się od `sk-ant-api03-`).

Powinno wyjść np.:
```
VITE_ANTHROPIC_API_KEY=sk-ant-api03-AbCdEf123XyZ...
```

Zapisz (Ctrl+S) i zamknij Notatnik.

### Krok 4: Zainstaluj zależności (jednorazowo)

```
npm install
```

Czeka 30-60 sek. Pobiera ~200 MB do folderu `node_modules`. Na końcu napisze `added X packages in Ys`. Żółte ostrzeżenia ignoruj.

### Krok 5: Uruchom

```
npm run dev
```

Po 2-3 sekundach terminal pokaże:
```
  ➜  Local:   http://localhost:5173/
```

**Otwórz w przeglądarce: http://localhost:5173**

Mikrofon przy pierwszym kliknięciu w Dzienniku zapyta o uprawnienia — Zezwól.

---

## ⚙️ Codzienne użycie

Aplikacja działa **tylko gdy terminal jest otwarty**. Po zamknięciu terminala = aplikacja gaśnie.

**Żeby zatrzymać**: w terminalu naciśnij `Ctrl+C`

**Żeby uruchomić ponownie**:
1. Otwórz cmd w folderze pacelab (przez pasek adresu Eksploratora jak w Kroku 2)
2. `npm run dev`

Dane (aktywności, plan, dziennik) zapisują się w `localStorage` Chrome'a — działają nawet po zamknięciu terminala, dopóki nie skasujesz historii przeglądarki.

---

## 📊 Pierwsze uruchomienie — co zrobić

1. **Ustawienia** → wpisz swoje progi: **FTP** (rower), **LTHR** (próg HR), **HR max**. Domyślne wartości mogą nie pasować — wpisz swoje, wtedy wszystkie zakresy stref się przeliczą.
2. **Cel** → datę zawodów (domyślnie 12.07.2026)
3. **Aktywności** → wgraj swoje pliki z Garmina (CSV lub TCX/GPX) — strefa importu na samej górze albo na Dashboardzie
4. **Dashboard** → karta "Dziś" pokazuje dzisiejszy trening z planu

---

## 🔑 Klucz API — koszty

Klucz API jest w pliku `.env` lokalnie. Apka wywołuje Claude Sonnet 4 do:
- Coach AI (chat)
- Analizy aktywności (ikona ✨)
- Generowanego planu tygodniowego
- Dziennika z sugestiami

**Typowe koszty przy aktywnym treningu: $2-5/miesiąc**.

W console.anthropic.com → Limits ustaw miesięczny limit np. 10 USD — zabezpieczenie.

---

## 🐛 Troubleshooting

**`'node' is not recognized`**
Node.js nie jest zainstalowany lub Windows nie widzi go w PATH. Zainstaluj z nodejs.org, **zrestartuj komputer**, sprawdź ponownie.

**`npm install` daje błędy**
Zwykle problem z siecią/firewall. Spróbuj `npm install --no-audit --no-fund`. Jeśli korpo VPN blokuje npm rejestru — wyłącz VPN tymczasowo.

**Przeglądarka mówi „Brak klucza API"**
Sprawdź czy plik `.env` istnieje w folderze pacelab (nie `.env.example`) i czy ma w środku poprawny klucz po znaku `=`. **Po edycji `.env` zatrzymaj `npm run dev` (Ctrl+C) i uruchom ponownie** — Vite czyta env tylko przy starcie.

**API zwraca błąd 401**
Klucz API niepoprawny lub wygasł. Sprawdź w console.anthropic.com.

**Mikrofon nie działa**
Chrome → kliknij 🔒 w pasku adresu → Microphone → Allow. Odśwież stronę.

**Dane zniknęły**
Dane są w `localStorage` przeglądarki. Zmiana przeglądarki lub wyczyszczenie ciasteczek = brak danych. Eksport: **Ustawienia → Eksport danych (JSON)** — rób regularnie kopię.

---

## 🎯 Cel: Triathlon 1/4 Bydgoszcz, 12.07.2026

Plan domyślny jest skonfigurowany pod ten konkretny start. Jeśli zmieniasz cel — edytuj w Ustawieniach: **Cel**, **Datę celu**, **Profil sportowca**, **Reguły coachingu**.

Powodzenia 🚴 🏃 🏊
