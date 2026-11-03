(function () {
  const items = [
    { href: "/dashboard", label: "Resumen", icon: "⌂", match: ["/", "/dashboard"] },
    { href: "/transportes-app", label: "Transportes", icon: "↗" },
    { href: "/clientes-app", label: "Clientes", icon: "♙" },
    { href: "/contenedores-app", label: "Contenedores", icon: "▣" },
    { href: "/cotizaciones-app", label: "Cotizaciones", icon: "▤" },
    { href: "/mensajes-app", label: "Mensajes", icon: "✉" }
  ];

  const currentPath = window.location.pathname;
  const isActive = (item) =>
    (item.match || [item.href]).includes(currentPath);

  const main = document.createElement("main");
  main.className = "main-content";
  while (document.body.firstChild) {
    main.appendChild(document.body.firstChild);
  }

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.setAttribute("aria-label", "Navegación principal");
  sidebar.innerHTML = `
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">M</div>
      <div>
        <strong>MiTransporte</strong>
        <span>IA · ERP LOGÍSTICO</span>
      </div>
    </div>
    <button class="sidebar-close" type="button" aria-label="Cerrar menú">×</button>
    <nav class="sidebar-nav">
      <span class="nav-caption">MENÚ PRINCIPAL</span>
      ${items.map((item) => `
        <a class="nav-item${isActive(item) ? " active" : ""}" href="${item.href}"${isActive(item) ? ' aria-current="page"' : ""}>
          <span class="nav-icon" aria-hidden="true">${item.icon}</span>
          <span>${item.label}</span>
        </a>
      `).join("")}
    </nav>
    <div class="sidebar-footer">
      <div class="help-card">
        <span class="help-icon">?</span>
        <div><strong>¿Necesitas ayuda?</strong><small>Habla con soporte</small></div>
      </div>
      <div class="user-card">
        <div class="avatar">AG</div>
        <div><strong>Admin General</strong><small>Administrador</small></div>
        <span class="user-menu">•••</span>
      </div>
    </div>
  `;

  const menuButton = document.createElement("button");
  menuButton.className = "mobile-menu";
  menuButton.type = "button";
  menuButton.setAttribute("aria-label", "Abrir menú");
  menuButton.innerHTML = "☰";

  document.body.append(sidebar, main, menuButton);

  const closeMenu = () => document.body.classList.remove("sidebar-open");
  menuButton.addEventListener("click", () => document.body.classList.add("sidebar-open"));
  sidebar.querySelector(".sidebar-close").addEventListener("click", closeMenu);
  sidebar.querySelectorAll(".nav-item").forEach((link) => link.addEventListener("click", closeMenu));
})();
