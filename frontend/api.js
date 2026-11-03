async function loadRecords(resource) {
  const response = await fetch(`/${resource}`);
  if (!response.ok) {
    throw new Error(`No se pudieron cargar ${resource}`);
  }
  return response.json();
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

function showApiError(error) {
  console.error(error);
  alert(error.message || "No se pudo completar la operación");
}
