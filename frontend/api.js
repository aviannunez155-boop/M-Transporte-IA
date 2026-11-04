async function loadRecords(resource) {
  const response = await fetch(`/${resource}`);
  if (!response.ok) {
    throw new Error(`No se pudieron cargar ${resource}`);
  }
  return response.json();
}

async function loadDashboardData(query = "") {
  const response = await fetch(`/dashboard-data${query}`);
  if (!response.ok) {
    throw new Error("No se pudo cargar el resumen del dashboard");
  }
  return response.json();
}

async function loadReports(query = "") {
  const response = await fetch(`/reports${query}`);
  if (!response.ok) {
    throw new Error("No se pudieron cargar los reportes");
  }
  return response.json();
}

async function getSession() {
  const response = await fetch("/api/session");
  if (!response.ok) return null;
  return response.json();
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
}

async function saveRecord(resource, record) {
  const response = await fetch(`/${resource}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `No se pudo guardar ${resource}`);
  }
  return response.json();
}

async function updateStatus(resource, id, estado) {
  const response = await fetch(`/${resource}/${id}/estado`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ estado })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "No se pudo actualizar el estado");
  }
  return response.json();
}

async function updateRecord(resource, id, record) {
  const response = await fetch(`/${resource}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `No se pudo actualizar ${resource}`);
  }
  return response.json();
}

async function deleteRecord(resource, id) {
  const response = await fetch(`/${resource}/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `No se pudo eliminar ${resource}`);
  }
  return response.json();
}

function showApiError(error) {
  console.error(error);
  alert(error.message || "No se pudo completar la operación");
}
