# LoL Builds

App de escritorio para Windows con builds, runas, orden de habilidades, tier list y aumentos (ARAM Mayhem y Arena) de League of Legends, al estilo OP.GG / Blitz.

## Descarga
[LoLBuilds.exe](https://github.com/HydraRsw/lolbuilds/raw/updates/LoLBuilds.exe) — después se actualiza sola.

## Uso
1. Ejecuta `LoLBuilds.exe` (no requiere instalación).
2. Busca un campeón (Ctrl+K) o navega por Inicio, Campeones, Tier List, ARAM Mayhem y Arena.
3. Con el cliente de LoL abierto:
   - En la selección de campeón la app abre sola tu campeón, con el modo (Clasificatoria / ARAM Mayhem / Arena) y tu rol asignado.
   - Al **fijar** tu campeón (en ARAM / ARAM Mayhem, en cuanto te toca) importa sola la build de objetos, y si lo activas en Ajustes también runas y hechizos.
   - **Importar todo** mete runas, build y hechizos de una vez.
   - **Importar runas** reemplaza tu página actual (o la que creó la app, con prefijo «LB»).
   - **Aplicar** hechizos de invocador.
   - **Importar al cliente** crea un set de objetos que aparece en la tienda del juego.
4. Ajustes (engranaje): región, rango, auto-abrir, importación automática, versión y «Buscar actualizaciones».

Windows mostrará un aviso de SmartScreen la primera vez porque el exe no está firmado: «Más información» → «Ejecutar de todas formas».

## TFT
Pestaña **TFT**: composiciones meta (OP.GG) con tier, Top 4 y posición promedio; tableros por etapa (inicio, medio y final) con posicionamiento en hexágonos, qué agregar o quitar entre etapas, carries con sus objetos, componentes a priorizar, guía «Cómo jugarla» y botón para copiar el código del Planificador de equipo. 

**Overlay de TFT:** dos ventanas siempre visibles encima del juego (TFT en modo *sin bordes*), sin barra de título: se arrastran desde ⠿ y recuerdan su posición. Se abren solas al empezar una partida de TFT (configurable) o con el botón de la pestaña TFT.
- **Composiciones** (derecha): compos meta con su tablero por etapa, objetos de los carries, componentes y botón para fijar tu compo.
- **Recetas** (barra horizontal): un componente por casilla; al hacer clic se despliega debajo todo lo que arma con cada otro componente, con estadísticas y en qué compos se usa. Los objetos de tu compo fijada se marcan en dorado.
- Atajos (controlan las dos): **Ctrl+Shift+X** ocultar/mostrar, **Ctrl+Shift+Z** dejar pasar los clics al juego.

Además: campeones con objetos ideales (BIS), tier list de objetos con recetas, emblemas y artefactos, y sinergias con el rendimiento de cada umbral (MetaTFT).

## Actualizaciones automáticas
- **Datos y parches:** cada vez que sale un parche la app lo detecta (revisa cada hora) y descarga las builds, runas y tier lists nuevas sola.
- **La app:** revisa cada 3 horas la rama `updates` de este repositorio. Si solo cambió la interfaz, se aplica sola sin reiniciar ni descargar otro .exe. Si cambió el motor, reemplaza su propio .exe y pide reiniciar. Todo se verifica con SHA-256.
- Publicar una versión: `./release.sh 1.2.2 "Notas"` (solo interfaz) o `./release.sh 1.3.0 "Notas" --exe`.

## Tecnología
- **Go** + **WebView2** nativo de Windows (el mismo motor de Edge): un solo `.exe` de ~7 MB, arranque inmediato y poca RAM, sin Electron.
- Servidor local en `127.0.0.1` con caché en disco (`%LOCALAPPDATA%\LoLBuilds\http`): funciona con los últimos datos aunque se caiga internet.
- Interfaz en HTML/CSS/JS sin frameworks, embebida en el exe.

## Datos
- Estadísticas: API pública de OP.GG (`lol-api-champion.op.gg`), se actualiza cada 90 min.
- Nombres, iconos y descripciones en español: Riot Data Dragon y CommunityDragon.
- Integración con el cliente: API local del cliente (LCU) leyendo el `lockfile`.

En ARAM Mayhem, OP.GG no publica win rate por aumento; la calificación S/A/B/C usa su índice de rendimiento. En Arena se usa el % de Top 4.

## Compilar
```
GOPROXY=direct GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w" -o LoLBuilds.exe .
```
`LOLB_DEBUG=1` habilita las herramientas de desarrollo dentro de la ventana.

App no oficial, no respaldada por Riot Games.
