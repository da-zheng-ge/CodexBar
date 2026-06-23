'use strict';

const primaryPercent = document.getElementById('primaryPercent');
const secondaryPercent = document.getElementById('secondaryPercent');
const thinkingIndicator = document.getElementById('thinkingIndicator');
const resetClock = document.getElementById('resetClock');
const statusSlot = document.getElementById('statusSlot');

function applySnapshot(snapshot) {
  const primary = snapshot.primaryRemainingPercent;
  const secondary = snapshot.secondaryRemainingPercent;

  if (!hasUsageValues(snapshot)) {
    primaryPercent.textContent = '--%';
    secondaryPercent.textContent = '--%';
    primaryPercent.className = 'percent';
    secondaryPercent.className = 'percent';
    setThinking(snapshot.isThinking);
    setResetTime(null);
    return;
  }

  primaryPercent.textContent = formatPercent(primary);
  secondaryPercent.textContent = formatPercent(secondary);
  primaryPercent.className = `percent ${toneFor(primary)}`;
  secondaryPercent.className = `percent ${toneFor(secondary)}`;
  setThinking(snapshot.isThinking);
  setResetTime(snapshot.primaryResetsAt);
}

function formatPercent(value) {
  return typeof value === 'number' ? `${value}%` : '--%';
}

function hasUsageValues(snapshot) {
  return typeof snapshot.primaryRemainingPercent === 'number'
    || typeof snapshot.secondaryRemainingPercent === 'number';
}

function toneFor(value) {
  if (typeof value !== 'number') {
    return '';
  }
  if (value <= 10) {
    return 'danger';
  }
  if (value <= 30) {
    return 'warn';
  }
  return '';
}

function setThinking(isThinking) {
  statusSlot.classList.toggle('thinking-active', Boolean(isThinking));
  thinkingIndicator.classList.toggle('active', Boolean(isThinking));
}

function setResetTime(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    resetClock.textContent = '--:--';
    return;
  }

  const timestampMs = timestamp < 100000000000 ? timestamp * 1000 : timestamp;
  resetClock.textContent = new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.codexbar.showContextMenu();
});

window.codexbar.onUsageUpdate(applySnapshot);
window.codexbar.getLatest().then(applySnapshot);
