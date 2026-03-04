import pandas as pd
from bs4 import BeautifulSoup
import re, os, json
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import datetime

# ─── Configurações ────────────────────────────────────────────────────────────
ARQUIVO_JS  = 'dados_olx.js'
ARQUIVO_CSV = 'base_grafos_olx.csv'

# ─── Marcas ───────────────────────────────────────────────────────────────────
MARCAS_CONHECIDAS = {
    "fiat","volkswagen","vw","chevrolet","gm","ford","toyota","honda","hyundai",
    "nissan","jeep","renault","peugeot","citroen","mitsubishi","kia","byd","chery",
    "troller","land","mercedes","bmw","audi","volvo","subaru","suzuki","ram","dodge",
    "caoa","jac","effa","great","haval","lifan","mg"
}
ALIAS_MARCA = {
    "vw":"Volkswagen","gm":"Chevrolet","land":"Land Rover",
    "great":"Great Wall","caoa":"CAOA Chery","mercedes":"Mercedes-Benz",
}
MARCAS_DUAS = {"land rover","great wall"}
STOP_SPECS = {
    'FLEX','AUT','MEC','TURBO','TB','CVT','DIESEL','GASOLINA','ELÉTRICO',
    'ELETRICO','HÍBRIDO','HIBRIDO','MPFI','TIVCT','HIFLEX','DUALOGIC',
    'AUTOMATICO','AUTOMÁTICO','MANUAL','INT.','EXT.','DIES.','DIE.','HP','CV',
}

# ─── Extração ─────────────────────────────────────────────────────────────────
def normalizar_marca(pw, titulo):
    p = pw.lower().strip()
    if p in ALIAS_MARCA: return ALIAS_MARCA[p]
    if p in MARCAS_CONHECIDAS: return pw.title()
    palavras = titulo.split()
    if len(palavras) >= 2:
        duas = (palavras[0]+" "+palavras[1]).lower()
        if duas in MARCAS_DUAS:
            return palavras[0].title()+" "+palavras[1].title()
    return pw.title()

def extrair_modelo(titulo, marca):
    palavras = titulo.split()
    bw = 1
    if len(palavras) >= 2:
        if (palavras[0]+" "+palavras[1]).lower() in MARCAS_DUAS:
            bw = 2
    modelo = []
    for p in palavras[bw:]:
        if re.match(r'^\d+[\.,]\d+', p): break
        if re.match(r'^\d+[Vv]$', p): break
        if re.match(r'^\d+cv$', p, re.I): break
        if p.upper().rstrip('.') in STOP_SPECS: break
        if re.match(r'^(19|20)\d{2}$', p): break
        modelo.append(p)
    result = ' '.join(modelo).strip()
    return result if result else (palavras[bw] if len(palavras) > bw else 'N/D')

def cidade_da_url(href):
    try:
        slug = href.replace("https://ba.olx.com.br/","").split("/")[0]
        slug = slug.replace("regiao-de-","").replace("-e-alagoinhas","")
        return slug.replace("-"," ").title() or None
    except: return None

def extrair_ano_km(titulo):
    ano = km = None
    m = re.search(r'\b(19[5-9]\d|20[0-3]\d)\b', titulo)
    if m: ano = int(m.group())
    m = re.search(r'(\d[\d.]+)\s*km', titulo, re.I)
    if m: km = int(re.sub(r'\D','',m.group(1)))
    return ano, km

def extrair_dados_do_html(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    anuncios, links_vistos = [], set()

    for card in soup.find_all('section', class_='olx-adcard'):
        link_tag = card.find('a', class_='olx-adcard__link')
        href = link_tag['href'] if link_tag and link_tag.get('href') else None
        if href in links_vistos: continue
        if href: links_vistos.add(href)

        title_tag = card.find('h2')
        titulo = title_tag.get_text(strip=True) if title_tag else ""
        if not titulo: continue

        marca  = normalizar_marca(titulo.split()[0], titulo)
        modelo = extrair_modelo(titulo, marca)

        price_tag = card.find('h3', class_='olx-adcard__price')
        valor = 0
        if price_tag:
            nums = re.sub(r'[^\d]','', price_tag.get_text())
            valor = int(nums) if nums else 0
        if valor == 0: continue

        location_tag = card.find('p', class_='olx-adcard__location')
        cidade = bairro = "N/D"
        if location_tag:
            raw = location_tag.get_text(strip=True)
            sem_uf = re.split(r'\s*-\s*[A-Z]{2}$', raw)[0].strip()
            if ',' in sem_uf:
                partes = [p.strip() for p in sem_uf.split(',',1)]
                cidade, bairro = partes[0], partes[1]
            else:
                cidade = sem_uf; bairro = "Centro/Geral"

        if re.match(r'^[A-Z]{2}$', cidade): cidade = "N/D"
        if cidade == "N/D" and href: cidade = cidade_da_url(href) or "N/D"

        ano, km_titulo = extrair_ano_km(titulo)
        km = None
        km_tag = card.find(lambda t: t.name and t.get('aria-label','').endswith('quilômetros rodados'))
        if km_tag:
            m = re.search(r'(\d+)', km_tag['aria-label'].replace('.',''))
            if m: km = int(m.group())
        if km is None: km = km_titulo

        anuncios.append({
            'marca': marca, 'modelo': modelo, 'titulo': titulo,
            'valor': valor, 'cidade': cidade, 'bairro': bairro,
            'ano': ano, 'km': km, 'link': href,
        })
    return anuncios

# ─── Deduplicação inteligente ─────────────────────────────────────────────────
def extrair_id_olx(url: str) -> str | None:
    """
    Extrai o ID numérico único de qualquer variante de URL da OLX.

    Formatos reconhecidos:
      • https://ba.olx.com.br/.../fiat-uno-...-1482725322   → 1482725322
      • https://www.olx.com.br/vi/1482725322?rec=l          → 1482725322  ← link curto
      • https://...?id=1482725322                           → 1482725322
    Todos os formatos acima resultam na MESMA chave → duplicata corretamente detectada.
    """
    if not url:
        return None
    # Padrão 1: /vi/XXXXXXXXX  (link curto — prioridade máxima)
    m = re.search(r'/vi/(\d{7,})', url)
    if m: return m.group(1)
    # Padrão 2: sequência numérica longa no final do path (antes de ? # ou /)
    m = re.search(r'-(\d{7,})(?:[/?#]|$)', url)
    if m: return m.group(1)
    # Padrão 3: query param ?id= ou &id=
    m = re.search(r'[?&]id=(\d{7,})', url)
    if m: return m.group(1)
    return None

def gerar_chave_unica(record):
    """
    Chave de unicidade baseada no ID numérico do anúncio OLX.
    Robusto a todas as variantes de URL (slug longo, /vi/ curto, parâmetros).

    Garante que:
      • Mesmo anúncio com URLs diferentes → mesma chave → duplicata ignorada ✓
      • Mesmo modelo com preços diferentes → IDs diferentes → ambos mantidos ✓
    """
    link = record.get('link') or ''
    olx_id = extrair_id_olx(link)
    if olx_id:
        return f"olx_id:{olx_id}"
    # Fallback sem link identificável
    titulo = (record.get('titulo') or '').lower().strip()
    valor  = str(record.get('valor') or 0)
    cidade = (record.get('cidade') or '').lower().strip()
    return f"fallback:{titulo}|{valor}|{cidade}"

def carregar_dados_existentes(arquivo_js):
    """Lê o dados_olx.js e retorna (lista_de_records, set_de_chaves)."""
    if not os.path.exists(arquivo_js):
        return [], set()
    with open(arquivo_js, 'r', encoding='utf-8') as f:
        conteudo = f.read()
    # Extrai o JSON do window.OLX_DATA = [...];
    m = re.search(r'window\.OLX_DATA\s*=\s*(\[.*\])\s*;', conteudo, re.DOTALL)
    if not m:
        return [], set()
    try:
        records = json.loads(m.group(1))
        chaves  = {gerar_chave_unica(r) for r in records}
        return records, chaves
    except json.JSONDecodeError:
        return [], set()

def salvar_dados(records, arquivo_js, arquivo_csv):
    """Grava dados_olx.js e base_grafos_olx.csv."""
    ts = datetime.datetime.now().strftime('%d/%m/%Y %H:%M')
    js = (
        "// Gerado automaticamente por scrapPaginas_v4.py\n"
        f"// Total: {len(records)} anúncios | Atualizado em: {ts}\n\n"
        "window.OLX_DATA = " + json.dumps(records, ensure_ascii=False, indent=2) + ";\n"
    )
    with open(arquivo_js, 'w', encoding='utf-8') as f:
        f.write(js)

    df = pd.DataFrame(records)
    df.to_csv(arquivo_csv, index=False, encoding='utf-8-sig')

# ─── GUI ──────────────────────────────────────────────────────────────────────
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("OLX Scraper — Importar Páginas")
        self.resizable(False, False)
        self.configure(bg="#0d0f14")

        DARK   = "#0d0f14"
        PANEL  = "#13161d"
        BORDER = "#1e2330"
        ACCENT = "#f0c040"
        TEXT   = "#e0e4ef"
        MUTED  = "#6b7391"
        GREEN  = "#3ecf8e"
        RED    = "#e84d3d"

        s = ttk.Style(self)
        s.theme_use('clam')
        s.configure('TFrame', background=PANEL)
        s.configure('TLabel', background=PANEL, foreground=TEXT, font=('Segoe UI', 9))
        s.configure('Header.TLabel', background=DARK, foreground=ACCENT,
                    font=('Segoe UI', 13, 'bold'))
        s.configure('Sub.TLabel', background=DARK, foreground=MUTED, font=('Segoe UI', 8))
        s.configure('TButton', background=PANEL, foreground=TEXT,
                    font=('Segoe UI', 9), borderwidth=1, relief='flat')
        s.map('TButton', background=[('active', BORDER)])
        s.configure('Accent.TButton', background=ACCENT, foreground='#000',
                    font=('Segoe UI', 9, 'bold'), borderwidth=0, relief='flat')
        s.map('Accent.TButton', background=[('active','#d4a820')])
        s.configure('TListbox', background=PANEL, foreground=TEXT,
                    selectbackground=BORDER, font=('Consolas', 9))
        s.configure('TScrollbar', background=BORDER, troughcolor=PANEL, borderwidth=0)
        s.configure('TProgressbar', background=ACCENT, troughcolor=PANEL)

        # ── Header ──
        hdr = tk.Frame(self, bg=DARK, pady=14, padx=20)
        hdr.pack(fill='x')
        tk.Label(hdr, text="OLX Scraper", bg=DARK, fg=ACCENT,
                 font=('Segoe UI', 15, 'bold')).pack(anchor='w')
        tk.Label(hdr, text="Selecione os arquivos .txt/.html das páginas OLX para importar",
                 bg=DARK, fg=MUTED, font=('Segoe UI', 9)).pack(anchor='w')

        # ── File list ──
        body = tk.Frame(self, bg=PANEL, padx=16, pady=12)
        body.pack(fill='both', expand=True)

        tk.Label(body, text="ARQUIVOS SELECIONADOS", bg=PANEL, fg=MUTED,
                 font=('Segoe UI', 8, 'bold')).pack(anchor='w')

        list_frame = tk.Frame(body, bg=PANEL)
        list_frame.pack(fill='both', expand=True, pady=(4,0))

        scrollbar = tk.Scrollbar(list_frame, bg=BORDER, troughcolor=PANEL, bd=0,
                                 highlightthickness=0, relief='flat')
        scrollbar.pack(side='right', fill='y')

        self.listbox = tk.Listbox(
            list_frame, bg="#1a1e2e", fg=TEXT, selectbackground=BORDER,
            font=('Consolas', 9), height=8, bd=0, highlightthickness=0,
            relief='flat', yscrollcommand=scrollbar.set, activestyle='none'
        )
        self.listbox.pack(side='left', fill='both', expand=True)
        scrollbar.config(command=self.listbox.yview)

        # ── Buttons row ──
        btns = tk.Frame(body, bg=PANEL, pady=8)
        btns.pack(fill='x')

        tk.Button(btns, text="+ Adicionar arquivos", bg=PANEL, fg=TEXT,
                  font=('Segoe UI', 9), relief='flat', bd=0, cursor='hand2',
                  highlightbackground=BORDER, highlightthickness=1,
                  command=self.add_files, padx=10, pady=4).pack(side='left', padx=(0,6))

        tk.Button(btns, text="✕ Remover selecionado", bg=PANEL, fg=MUTED,
                  font=('Segoe UI', 9), relief='flat', bd=0, cursor='hand2',
                  command=self.remove_selected, padx=10, pady=4).pack(side='left')

        # ── Output paths ──
        paths = tk.Frame(body, bg=PANEL, pady=4)
        paths.pack(fill='x')

        tk.Label(paths, text="SAÍDA", bg=PANEL, fg=MUTED,
                 font=('Segoe UI', 8, 'bold')).grid(row=0, column=0, sticky='w', columnspan=2)

        tk.Label(paths, text="JS:", bg=PANEL, fg=MUTED,
                 font=('Segoe UI', 8)).grid(row=1, column=0, sticky='w', pady=1)
        self.js_var = tk.StringVar(value=os.path.abspath(ARQUIVO_JS))
        tk.Label(paths, textvariable=self.js_var, bg=PANEL, fg=TEXT,
                 font=('Consolas', 8)).grid(row=1, column=1, sticky='w', padx=6)

        tk.Label(paths, text="CSV:", bg=PANEL, fg=MUTED,
                 font=('Segoe UI', 8)).grid(row=2, column=0, sticky='w', pady=1)
        self.csv_var = tk.StringVar(value=os.path.abspath(ARQUIVO_CSV))
        tk.Label(paths, textvariable=self.csv_var, bg=PANEL, fg=TEXT,
                 font=('Consolas', 8)).grid(row=2, column=1, sticky='w', padx=6)

        tk.Button(paths, text="📁 Mudar pasta", bg=PANEL, fg=MUTED,
                  font=('Segoe UI', 8), relief='flat', bd=0, cursor='hand2',
                  command=self.mudar_pasta, padx=6, pady=2).grid(row=1, column=2, rowspan=2, padx=6)

        # ── Status box ──
        self.status_frame = tk.Frame(body, bg="#0d1117", pady=8, padx=10)
        self.status_frame.pack(fill='x', pady=(8,0))

        self.status_var = tk.StringVar(value="Aguardando…")
        self.status_lbl = tk.Label(self.status_frame, textvariable=self.status_var,
                                   bg="#0d1117", fg=MUTED, font=('Consolas', 9),
                                   justify='left', anchor='w', wraplength=460)
        self.status_lbl.pack(fill='x')

        self.progress = ttk.Progressbar(body, mode='determinate', style='TProgressbar')
        self.progress.pack(fill='x', pady=(4,0))

        # ── Run button ──
        footer = tk.Frame(self, bg=DARK, padx=16, pady=12)
        footer.pack(fill='x')

        self.run_btn = tk.Button(
            footer, text="▶  Importar e atualizar dados_olx.js",
            bg=ACCENT, fg="#000", font=('Segoe UI', 10, 'bold'),
            relief='flat', bd=0, cursor='hand2', padx=16, pady=8,
            command=self.run
        )
        self.run_btn.pack(side='right')

        tk.Button(footer, text="Fechar", bg=PANEL, fg=MUTED,
                  font=('Segoe UI', 9), relief='flat', bd=0, cursor='hand2',
                  padx=12, pady=6, command=self.destroy).pack(side='right', padx=8)

        self.files = []
        self._pasta = os.getcwd()

        self.geometry("540x520")
        self.eval('tk::PlaceWindow . center')

    # ── helpers ──────────────────────────────────────────────────────────────
    def set_status(self, msg, color="#6b7391"):
        self.status_var.set(msg)
        self.status_lbl.config(fg=color)
        self.update_idletasks()

    def add_files(self):
        paths = filedialog.askopenfilenames(
            title="Selecionar páginas OLX",
            filetypes=[("Arquivos HTML/TXT", "*.txt *.html *.htm"), ("Todos", "*.*")],
            initialdir=self._pasta
        )
        added = 0
        for p in paths:
            if p not in self.files:
                self.files.append(p)
                self.listbox.insert('end', f"  {os.path.basename(p)}")
                added += 1
        if added:
            self.set_status(f"{len(self.files)} arquivo(s) na fila.")

    def remove_selected(self):
        sel = self.listbox.curselection()
        if not sel: return
        idx = sel[0]
        self.listbox.delete(idx)
        self.files.pop(idx)
        self.set_status(f"{len(self.files)} arquivo(s) na fila.")

    def mudar_pasta(self):
        pasta = filedialog.askdirectory(title="Pasta de saída", initialdir=self._pasta)
        if pasta:
            self._pasta = pasta
            self.js_var.set(os.path.join(pasta, ARQUIVO_JS))
            self.csv_var.set(os.path.join(pasta, ARQUIVO_CSV))

    def run(self):
        if not self.files:
            messagebox.showwarning("Nenhum arquivo", "Adicione ao menos um arquivo antes de importar.")
            return

        self.run_btn.config(state='disabled')
        js_path  = self.js_var.get()
        csv_path = self.csv_var.get()

        # ── Carrega base existente ────────────────────────────────────────────
        self.set_status("Carregando base existente…")
        existentes, chaves_existentes = carregar_dados_existentes(js_path)
        total_antes = len(existentes)

        novos_total = 0
        ignorados_total = 0
        self.progress['maximum'] = len(self.files)
        self.progress['value'] = 0

        # ── Processa cada arquivo ────────────────────────────────────────────
        for i, arquivo in enumerate(self.files, 1):
            nome = os.path.basename(arquivo)
            self.set_status(f"[{i}/{len(self.files)}] Lendo {nome}…")

            try:
                with open(arquivo, 'r', encoding='utf-8', errors='replace') as f:
                    conteudo = f.read()
            except Exception as e:
                self.set_status(f"⚠ Erro ao ler {nome}: {e}", "#e84d3d")
                continue

            dados = extrair_dados_do_html(conteudo)
            novos_arquivo = 0

            for record in dados:
                chave = gerar_chave_unica(record)
                if chave in chaves_existentes:
                    ignorados_total += 1
                else:
                    chaves_existentes.add(chave)
                    existentes.append(record)
                    novos_arquivo += 1
                    novos_total += 1

            self.set_status(
                f"[{i}/{len(self.files)}] {nome} → +{novos_arquivo} novos, "
                f"{len(dados)-novos_arquivo} já existiam"
            )
            self.progress['value'] = i
            self.update_idletasks()

        # ── Salva ─────────────────────────────────────────────────────────────
        self.set_status("Salvando arquivos…")
        salvar_dados(existentes, js_path, csv_path)

        # ── Relatório final ───────────────────────────────────────────────────
        msg = (
            f"✅ Concluído!\n"
            f"   Base anterior : {total_antes} anúncios\n"
            f"   Novos adicionados : {novos_total}\n"
            f"   Duplicatas ignoradas : {ignorados_total}\n"
            f"   Total atual : {len(existentes)} anúncios"
        )
        self.set_status(msg, "#3ecf8e")
        self.run_btn.config(state='normal')

        messagebox.showinfo(
            "Importação concluída",
            f"Base atualizada com sucesso!\n\n"
            f"✦ Novos anúncios adicionados: {novos_total}\n"
            f"✦ Duplicatas ignoradas: {ignorados_total}\n"
            f"✦ Total na base: {len(existentes)} anúncios\n\n"
            f"Arquivo salvo em:\n{js_path}"
        )

# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == '__main__':
    app = App()
    app.mainloop()
