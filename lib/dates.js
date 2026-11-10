// Dates au format AAAA-MM-JJ (UTC), partagées par les modules de stats.

function todayDate() {
    return new Date().toISOString().slice(0, 10);
}

// Les `n` derniers jours, du plus ancien au plus récent (aujourd'hui en dernier).
function lastDays(n = 14) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }
    return days;
}

module.exports = { todayDate, lastDays };
