'use strict';
/* i18n. Spanish is the source language: L('texto') returns the English text when
   the app is in English. {name} placeholders are filled from the second argument.
   The language lives in the app (/api/prefs) so the main window and both overlay
   windows always agree; it defaults to the Windows language. */
const LANG = (() => {
  if (window.LB_PREFS) return LB_PREFS.lang || (/^es/i.test(navigator.language || '') ? 'es' : 'en');
  try {
    const x = new XMLHttpRequest();
    x.open('GET', '/api/prefs', false);
    x.send();
    if (x.status === 200) { const p = JSON.parse(x.responseText); if (p.lang === 'es' || p.lang === 'en') return p.lang; }
  } catch { }
  return /^es/i.test(navigator.language || '') ? 'es' : 'en';
})();
document.documentElement.lang = LANG;
// locale of game data (champion/item/rune names and descriptions) and numbers
const DATA_LOC = LANG === 'en' ? { dd: 'en_US', cd: 'en_us', num: 'en-US' } : { dd: 'es_MX', cd: 'es_mx', num: 'es' };

function L(s, v) {
  let r = LANG === 'en' && Object.prototype.hasOwnProperty.call(EN, s) ? EN[s] : s;
  if (v) r = r.replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m));
  return r;
}
// Static HTML: data-i18n (text), data-i18n-ph (placeholder), data-i18n-title (title).
function i18nDom(root = document) {
  if (LANG === 'es') return;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = L(el.textContent.trim()); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = L(el.placeholder); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = L(el.title); });
}
document.addEventListener('DOMContentLoaded', () => i18nDom());

const EN = {
  // ---- shell / settings ----
  'Inicio': 'Home', 'Campeones': 'Champions', 'Buscar campeón…': 'Search champion…', 'Ajustes': 'Settings',
  'Cliente no detectado': 'Client not detected', 'Cliente conectado': 'Client connected',
  'Cargando datos del parche…': 'Loading patch data…', 'Idioma': 'Language',
  'Región de estadísticas': 'Stats region', 'Rango (clasificatoria)': 'Rank (ranked)',
  'Abrir automáticamente mi campeón en la selección': 'Open my champion automatically in champ select',
  'Al fijar tu campeón, importar automáticamente:': 'When you lock in your champion, import automatically:',
  'Build de objetos (aparece en la tienda del juego)': 'Item build (shows up in the in-game shop)',
  'Página de runas': 'Rune page', 'Hechizos de invocador': 'Summoner spells', 'TFT:': 'TFT:',
  'Abrir el overlay automáticamente al empezar una partida de TFT': 'Open the overlay automatically when a TFT game starts',
  'Actualizar datos': 'Refresh data', 'Listo': 'Done', 'Buscar actualizaciones': 'Check for updates',
  'Buscando actualizaciones…': 'Checking for updates…', 'Datos actualizados': 'Data refreshed',
  'TFT: OP.GG (composiciones), MetaTFT (estadísticas). Datos: OP.GG (estadísticas), Riot Data Dragon y CommunityDragon (nombres e iconos). App no oficial; no está respaldada por Riot Games.':
    'TFT: OP.GG (comps), MetaTFT (stats). Data: OP.GG (stats), Riot Data Dragon and CommunityDragon (names and icons). Unofficial app; not endorsed by Riot Games.',
  'Versión': 'Version', 'motor': 'engine', 'buscando…': 'checking…', 'al día': 'up to date',
  'Instalando…': 'Installing…', 'La app se reiniciará en un momento': 'The app will restart in a moment',
  'Actualización {v} disponible': 'Update {v} available', 'Clic para instalar': 'Click to install',
  'Parche': 'Patch', '¡Nuevo parche {v}! Builds, runas y tier list actualizadas.': 'New patch {v}! Builds, runes and tier list updated.',
  'Respuesta inválida': 'Invalid response', 'Cargando…': 'Loading…',
  'No se pudieron cargar los datos.': 'Could not load the data.',
  'Revisa tu conexión a internet o cambia la región en Ajustes.': 'Check your internet connection or change the region in Settings.',
  'Reintentar': 'Retry',
  // regions / ranks / roles / modes
  'Global (todas)': 'Global (all)', 'Corea': 'Korea', 'EU Oeste': 'EU West', 'Norteamérica': 'North America', 'Brasil': 'Brazil',
  'EU Nórdica/Este': 'EU Nordic & East', 'Japón': 'Japan', 'Oceanía': 'Oceania', 'Turquía': 'Turkey',
  'Todos': 'All', 'Todas': 'All', 'Oro+': 'Gold+', 'Platino+': 'Platinum+', 'Esmeralda+': 'Emerald+', 'Diamante+': 'Diamond+',
  'Maestro+': 'Master+', 'Retador': 'Challenger',
  'Superior': 'Top', 'Jungla': 'Jungle', 'Central': 'Mid', 'Tirador': 'Bot', 'Soporte': 'Support', 'Clasificatoria': 'Ranked',
  // client phases
  'En el cliente': 'In client', 'En sala': 'In lobby', 'Buscando partida': 'In queue', 'Partida encontrada': 'Match found',
  'Selección de campeón': 'Champ select', 'En partida': 'In game', 'Fin de partida': 'Post game',
  // home / lists
  'Builds, runas, orden de habilidades, aumentos y tier list del parche actual': 'Builds, runes, skill order, augments and tier list for the current patch',
  'Busca un campeón (Ahri, Jinx, Lee Sin…)': 'Search a champion (Ahri, Jinx, Lee Sin…)',
  'Mejores por rol': 'Best by role', 'Ver tier list completa →': 'Full tier list →', 'Campeones más fuertes ahora': 'Strongest champions right now',
  'Ver todo →': 'See all →', 'Cargando tier list…': 'Loading tier list…', 'Filtrar por nombre…': 'Filter by name…',
  'Campeón': 'Champion', 'Rol': 'Role', '1.er lugar': '1st place', 'Partidas': 'Games', 'partidas': 'games', 'part.': 'games', 'gana': 'wins',
  // champion page
  'Campeón no encontrado': 'Champion not found', 'Ver en OP.GG ↗': 'View on OP.GG ↗', 'Cargando build…': 'Loading build…',
  'Mejor': 'Best', 'Común': 'Common', 'Builds principales': 'Top builds', 'Build de objetos': 'Item build', 'Importar build': 'Import build',
  'Objetos iniciales': 'Starting items', 'Botas': 'Boots', 'Orden de construcción (núcleo)': 'Build path (core)',
  'Objetos situacionales (4.º–6.º)': 'Situational items (4th–6th)', 'Aplicar': 'Apply', 'uso': 'pick', 'Runas': 'Runes',
  'Abre el cliente de LoL para importar': 'Open the LoL client to import', 'Importar runas': 'Import runes', 'Fragmentos': 'Shards',
  'Orden de habilidades': 'Skill order', 'Prioridad:': 'Priority:', 'Difícil contra': 'Hard against', 'Fácil contra': 'Easy against',
  'tu win rate': 'your win rate', 'OP.GG no tiene suficientes datos de {name} en este modo/rol todavía.': 'OP.GG does not have enough data for {name} in this mode/role yet.',
  'Cliente de LoL conectado': 'LoL client connected', ' · importa la build de {name} con un clic': ' · import {name}\'s build in one click',
  'Importar todo': 'Import all', 'Objeto': 'Item', '{n} de oro': '{n} gold', 'Runa': 'Rune', 'Aumento': 'Augment',
  'Fuerza adaptable': 'Adaptive Force', 'Velocidad de ataque': 'Attack Speed', 'Aceleración de habilidades': 'Ability Haste',
  'Velocidad de movimiento': 'Move Speed', 'Vida escalable': 'Scaling Health', 'Vida': 'Health',
  'Tenacidad y resist. a ralentización': 'Tenacity and Slow Resist', 'Armadura': 'Armor', 'Resistencia mágica': 'Magic Resist',
  // augments
  'Aumentos prismáticos': 'Prismatic augments', 'Aumentos de oro': 'Gold augments', 'Aumentos de plata': 'Silver augments',
  'Mejores aumentos de Arena': 'Best Arena augments', 'Tier list de aumentos ARAM Mayhem': 'ARAM Mayhem augment tier list',
  'Calificados por porcentaje de Top 4 (con suficiente muestra).': 'Graded by Top 4 rate (with enough games).',
  'Calificados por el índice de rendimiento de OP.GG; «Pop.» es la popularidad entre jugadores de este campeón.': 'Graded by OP.GG\'s performance index; “Pop.” is the popularity among players of this champion.',
  'Mostrar solo los mejores': 'Show only the best', 'Mostrar todos los aumentos': 'Show all augments', 'Rend.': 'Perf.',
  // client imports
  'Iniciales': 'Starting', 'Iniciales (alternativa)': 'Starting (alternative)', 'Habilidades': 'Skills',
  'Build principal ({wr} WR)': 'Main build ({wr} WR)', 'Build alternativa {n} ({wr} WR)': 'Alternative build {n} ({wr} WR)',
  'Situacionales (4.º–6.º)': 'Situational (4th–6th)', 'No hay runas para este modo': 'No runes for this mode', 'runas': 'runes',
  'No hay hechizos para este modo': 'No spells for this mode', 'hechizos': 'spells', 'No hay build de objetos para este modo': 'No item build for this mode',
  'build de objetos': 'item build', 'Tipo desconocido': 'Unknown type', '{name}: {what} importados ✔': '{name}: {what} imported ✔',
  'No se pudo importar': 'Could not import', 'Build de {name} importada: la verás en la tienda del juego ✔': '{name} build imported: you\'ll see it in the in-game shop ✔',
  '{What} de {name} importados ✔': '{name} {what} imported ✔', 'No se pudo descargar la build de {name}': 'Could not download {name}\'s build',
  'Importado automáticamente para {name}: {what} ✔': 'Auto-imported for {name}: {what} ✔', 'No se pudo importar para {name}: {err}': 'Could not import for {name}: {err}',
  // overlay toggles
  'No se pudo abrir el overlay': 'Could not open the overlay', 'Overlay cerrado': 'Overlay closed',
  'Overlay abierto · Ctrl+Shift+X lo oculta, Ctrl+Shift+Z deja pasar los clics, Ctrl+Shift+C muestra u oculta las recetas': 'Overlay open · Ctrl+Shift+X hides it, Ctrl+Shift+Z lets clicks through, Ctrl+Shift+C shows/hides the recipes',
  'Partida de TFT detectada: overlay abierto (Ctrl+Shift+X para ocultarlo)': 'TFT game detected: overlay open (Ctrl+Shift+X to hide it)',
  // messages from the app engine
  'cliente de LoL no detectado': 'LoL client not detected', 'página de runas inválida': 'invalid rune page', 'datos inválidos': 'invalid data',
  'Solo se puede durante la selección de campeón': 'Only possible during champ select', 'el overlay solo funciona en Windows': 'the overlay only works on Windows',
  'OP.GG no devolvió composiciones': 'OP.GG returned no comps',
  // ---- TFT ----
  'Composiciones': 'Comps', 'Objetos': 'Items', 'Sinergias': 'Traits', 'Composición': 'Comp', 'Fácil': 'Easy', 'Media': 'Medium', 'Difícil': 'Hard',
  'Abrir / cerrar overlay': 'Open / close overlay', 'Ventana siempre visible encima del juego (TFT en modo sin bordes)': 'Always-on-top window over the game (TFT in borderless mode)',
  'Cargando datos de TFT…': 'Loading TFT data…', 'Filtrar por campeón o sinergia…': 'Filter by champion or trait…', 'Orden: Tier': 'Sort: Tier',
  'Posición promedio': 'Average placement', 'Popularidad': 'Popularity', '{n} composiciones · OP.GG': '{n} comps · OP.GG',
  'Prom.': 'Avg.', 'Victoria': 'Win', 'Uso': 'Pick', 'No hay composiciones con ese filtro.': 'No comps match that filter.',
  'Solo con {name}': 'Only with {name}', 'Requiere {name}': 'Requires {name}', 'Requisito': 'Requirement',
  'Esta compo solo rinde si consigues este aumento.': 'This comp only performs if you get this augment.',
  'Esta compo necesita este emblema para ser buena.': 'This comp needs this emblem to be good.',
  'Esta compo solo es buena si te sale el aumento <b>{name}</b>. Juégala cuando te lo ofrezcan; si no aparece, elige otra compo.': 'This comp is only good if you are offered the <b>{name}</b> augment. Play it when you get it; if it does not show up, pick another comp.',
  'Necesita <b>{name}</b> para ser buena. Búscalo en el carrusel, en los aumentos o en los monstruos; sin él, cambia a otra compo.': 'It needs <b>{name}</b> to be good. Look for it in the carousel, augments or monster drops; without it, switch to another comp.',
  'Reroll nivel {n}': 'Reroll level {n}', 'Rolear en nivel {n}': 'Roll at level {n}',
  'Composición no encontrada (puede que el meta haya cambiado).': 'Comp not found (the meta may have changed).',
  'Inicio·etapa': 'Early', 'Medio': 'Mid', 'Final': 'Final', 'Nivel': 'Level',
  'Este tablero gana el <b class="{cls}">{wr}</b> de las rondas ({n} partidas).': 'This board wins <b class="{cls}">{wr}</b> of rounds ({n} games).',
  'Sinergias activas': 'Active traits', 'Qué cambiar desde «{s}»': 'What to change from “{s}”', 'Agregar': 'Add', 'Quitar': 'Remove',
  'Mismas unidades; mejora estrellas y posiciones.': 'Same units; upgrade stars and positions.', 'Unidades': 'Units',
  'Dificultad: {d}': 'Difficulty: {d}', 'Costo total {n} de oro': 'Total cost {n} gold', 'Partidas·tft': 'Games',
  'Pégalo en el Planificador de equipo dentro de TFT': 'Paste it in the Team Planner inside TFT', 'Copiar código de equipo': 'Copy team code',
  'Tableros por etapa': 'Boards by stage', 'posicionamiento recomendado': 'recommended positioning',
  'OP.GG no publica tableros para esta compo: ': 'OP.GG does not publish boards for this comp: ',
  'inicio y medio tomados de la compo similar «{name}»': 'early and mid taken from the similar comp “{name}”',
  'la posición final es aproximada (tanques adelante, carries atrás)': 'the final positioning is approximate (tanks in front, carries in the back)',
  'Carries y objetos': 'Carries and items', 'Componentes a priorizar': 'Components to prioritize',
  'A la derecha: alternativas con mejores resultados según MetaTFT.': 'On the right: alternatives with the best results according to MetaTFT.',
  'Cómo jugarla': 'How to play it', 'Código copiado: pégalo en el Planificador de equipo de TFT ✔': 'Code copied: paste it in the TFT Team Planner ✔',
  'Copia este código:': 'Copy this code:',
  'Etapa 2 · Inicio': 'Stage 2 · Early', 'Etapa 3 · Medio': 'Stage 3 · Mid', 'Etapa 3–4 · Reroll': 'Stage 3–4 · Reroll', 'Etapa 4 · Roll down': 'Stage 4 · Roll down', 'Consejo': 'Tip',
  'Juega <b>{units}</b> (nivel {lvl}){traits}. {comps}Si te llegan los objetos del carry, póntelos a la unidad más fuerte del tablero y pásalos luego.': 'Play <b>{units}</b> (level {lvl}){traits}. {comps}If you get the carry\'s items, put them on the strongest unit on the board and pass them along later.',
  ', activando {t}': ', activating {t}', 'Busca en el carrusel y en los monstruos estos componentes: <b>{c}</b>. ': 'Look for these components on carousel and monster rounds: <b>{c}</b>. ',
  'Sube a nivel {lvl} y transiciona{add}{goal}. Mantén la economía por encima de 30–50 de oro si tu vida lo permite.': 'Go to level {lvl} and transition{add}{goal}. Keep your economy above 30–50 gold if your HP allows it.',
  ' agregando <b>{u}</b>': ' by adding <b>{u}</b>', '. Objetivo: {t}': '. Goal: {t}',
  'Quédate en nivel {r} y rolea poco a poco (por encima de 50 de oro) hasta conseguir <b>{u}</b> a 3★. Después sube de nivel para completar el tablero.': 'Stay at level {r} and slow roll (above 50 gold) until you have <b>{u}</b> at 3★. Then level up to finish the board.',
  'Sube a nivel {r} en 4-1 o 4-2 y rolea para encontrar {who} a 2★.{keep}': 'Go to level {r} at 4-1 or 4-2 and roll down to find {who} at 2★.{keep}',
  'tus carries principales': 'your main carries', ' Mantén las copias para tener <b>{u}</b> a 3★.': ' Keep the copies to get <b>{u}</b> at 3★.',
  'Tablero completo ({n} unidades): <b>{t}</b>. {carries}Revisa la pestaña «Final» para el posicionamiento exacto: tanques al frente, carries atrás.': 'Full board ({n} units): <b>{t}</b>. {carries}Check the “Final” tab for exact positioning: tanks in front, carries in the back.',
  'Carries en orden de prioridad: {c}. ': 'Carries in priority order: {c}. ',
  'Composición difícil: necesita conseguir unidades caras o mucha precisión con objetos. Si en la etapa 3 no tienes los componentes, cambia a una alternativa.': 'Hard comp: it needs expensive units or precise itemization. If you don\'t have the components by stage 3, pivot to an alternative.',
  'Composición fácil de ejecutar: buena para subir de forma estable.': 'Easy comp to execute: good for climbing consistently.',
  'No se pudieron cargar los campeones de TFT.': 'Could not load the TFT champions.', 'Por costo': 'By cost', 'Mejores (prom.)': 'Best (avg.)',
  'Costo {n}': 'Cost {n}', 'Objetos ideales (BIS)': 'Best items (BIS)', 'Alternativas': 'Alternatives', 'Usados en composiciones meta': 'Used in meta comps',
  'Sin datos de objetos para esta unidad.': 'No item data for this unit.', 'habilidad': 'ability', 'Composiciones con {name}': 'Comps with {name}',
  'No aparece en las composiciones meta actuales.': 'Not in the current meta comps.', 'Combinados': 'Combined', 'Emblemas': 'Emblems',
  'Artefactos y otros': 'Artifacts and others', 'Recetas': 'Recipes', 'Posición promedio y Top 4 de los últimos 3 días (MetaTFT)': 'Average placement and Top 4 over the last 3 days (MetaTFT)',
  'Receta': 'Recipe', 'Mejor en': 'Best on', '{n} unidades': '{n} units', 'En esta compo': 'In this comp', 'prom.': 'avg.',
  'Receta: {r}': 'Recipe: {r}',
  // overlay
  'Composiciones TFT': 'TFT comps', 'ocultar': 'hide', 'atravesar clics': 'click-through', 'arrastra para mover': 'drag to move',
  'Clics atraviesan': 'Click-through', 'Buscar campeón o sinergia…': 'Search champion or trait…', 'Sin resultados.': 'No results.',
  'prom': 'avg', 'Tablero': 'Board', 'Objetos de los carries': 'Carry items', 'Componentes': 'Components', 'Quitar fijado': 'Unpin',
  '📌 Fijar esta compo': '📌 Pin this comp', 'Copiar código': 'Copy code', 'Compo fijada arriba': 'Comp pinned on top', 'Compo quitada': 'Comp unpinned',
  'Código copiado ✔': 'Code copied ✔', 'Arrastra para mover': 'Drag to move', 'Sin datos de objetos.': 'No item data.',
  // mobile
  'El overlay funciona en la app de Android: descárgala arriba.': 'The overlay works in the Android app: download it above.',
  'Nueva versión de la app': 'New app version', 'Toca para descargarla': 'Tap to download it',
  'App de Android con overlay': 'Android app with overlay', 'Descarga el APK para ver compos y recetas encima de TFT': 'Download the APK to see comps and recipes on top of TFT',
  'Instálala en tu iPhone': 'Install it on your iPhone', 'Compartir → «Agregar a inicio»': 'Share → “Add to Home Screen”',
  'mejor en': 'best on', 'compos': 'comps', 'recetas': 'recipes',
  'Cerrar (Ctrl+Shift+C para volver a abrirla)': 'Close (Ctrl+Shift+C to open it again)',
};
