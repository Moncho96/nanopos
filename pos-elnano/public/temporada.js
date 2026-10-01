// Sistema de temporadas — le cambia un acento visual (color + un emoji) al header
// según la fecha, sin estorbar nada de la operación. Se actualiza solo, no hay que
// tocar nada manualmente mes con mes.
function obtenerTemporadaActual(fecha) {
  const hoy = fecha || new Date();
  const mes = hoy.getMonth() + 1; // 1-12
  const dia = hoy.getDate();

  // Día de Muertos / Halloween: todo octubre hasta el 2 de noviembre
  if (mes === 10 || (mes === 11 && dia <= 2)) {
    return { nombre: 'Día de Muertos', emoji: '💀', color: '#ff7a1a', colorOscuro: '#2a1a40', franja: 'linear-gradient(90deg, #ff7a1a, #6b2fa0, #ff7a1a)' };
  }
  // Navidad: todo diciembre + primera semana de enero
  if (mes === 12 || (mes === 1 && dia <= 6)) {
    return { nombre: 'Navidad', emoji: '🎄', color: '#1a7d3a', colorOscuro: '#7e1322', franja: 'linear-gradient(90deg, #1a7d3a, #d4af37, #b8232f)' };
  }
  // Día de la Independencia: 10-20 de septiembre
  if (mes === 9 && dia >= 10 && dia <= 20) {
    return { nombre: 'Fiestas Patrias', emoji: '🇲🇽', color: '#006847', colorOscuro: '#ce1126', franja: 'linear-gradient(90deg, #006847, #ffffff, #ce1126)' };
  }
  // San Valentín: 1-14 de febrero
  if (mes === 2 && dia <= 14) {
    return { nombre: 'San Valentín', emoji: '💘', color: '#e0457b', colorOscuro: '#9c1f4a', franja: 'linear-gradient(90deg, #e0457b, #ff8fab, #e0457b)' };
  }
  // Día de las Madres en México: 1-10 de mayo
  if (mes === 5 && dia <= 10) {
    return { nombre: 'Día de las Madres', emoji: '💐', color: '#e0457b', colorOscuro: '#1a7d3a', franja: 'linear-gradient(90deg, #e0457b, #ffb6c1, #e0457b)' };
  }
  return null; // resto del año: sin tema especial, colores normales de la marca
}

function aplicarTemporadaVisual() {
  const temporada = obtenerTemporadaActual();
  const header = document.querySelector('header');
  if (!temporada || !header) return;

  // Una franjita de color arriba del header, y un emoji junto al logo — discreto,
  // no cambia nada de la operación del día a día.
  const franja = document.createElement('div');
  franja.style.cssText = `height:4px;background:${temporada.franja};`;
  header.parentNode.insertBefore(franja, header);

  const h1 = header.querySelector('h1');
  if (h1) {
    const emojiSpan = document.createElement('span');
    emojiSpan.textContent = ' ' + temporada.emoji;
    emojiSpan.title = temporada.nombre;
    h1.appendChild(emojiSpan);
  }
}

document.addEventListener('DOMContentLoaded', aplicarTemporadaVisual);
