import pandas as pd
from bs4 import BeautifulSoup
import re, os, json, threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import datetime
from pathlib import Path

# ─── Configurações ────────────────────────────────────────────────────────────
ARQUIVO_JS  = 'dados_olx.js'
ARQUIVO_CSV = 'base_grafos_olx.csv'

# ─── Marcas e Filtros ─────────────────────────────────────────────────────────
MARCAS_CONHECIDAS = {
    "fiat","volkswagen","vw","chevrolet","gm","ford","toyota","honda","hyundai",
    "nissan","jeep","renault","peugeot","citroen","mitsubishi","kia","byd","chery",
    "troller","land","mercedes","bmw","audi","volvo","subaru","suzuki","ram","dodge",
    "caoa","jac","effa","great","haval","lifan","mg","gwm","porsche","ferrari",
    "lexus","infiniti","genesis","mini","jaguar","alfa","cupra","seat","skoda",
}
ALIAS_MARCA = {
    "vw":       "Volkswagen",
    "gm":       "Chevrolet",
    "land":     "Land Rover",
    "great":    "Great Wall",
    "caoa":     "CAOA Chery",
    "mercedes": "Mercedes-Benz",
    "alfa":     "Alfa Romeo",
}
MARCAS_DUAS = {"land rover", "great wall", "alfa romeo"}

TERMOS_PROIBIDOS = {
    'casa','apto','apartamento','aluguel','locação','alugo','temporada',
    'terreno','sobrado','sala comercial','ponto comercial','fazenda','sítio',
    'bagageiro','maleiro','peças','sucata','rodas','pneu','capacete',
    'volante','som automotivo','carro de som',
}

STOP_SPECS = {
    'FLEX','AUT','MEC','TURBO','TB','CVT','DIESEL','GASOLINA','ELÉTRICO',
    'ELETRICO','HÍBRIDO','HIBRIDO','MPFI','TIVCT','HIFLEX','DUALOGIC',
    'AUTOMATICO','AUTOMÁTICO','MANUAL','INT.','EXT.','DIES.','DIE.','HP','CV',
}

# Regex pré-compilados (compilar uma vez = muito mais rápido em loop)
RE_PRECO_DECIMAL  = re.compile(r'^\d+[\.,]\d+')
RE_POTENCIA_V     = re.compile(r'^\d+[Vv]$')
RE_POTENCIA_CV    = re.compile(r'^\d+cv$', re.I)
RE_ANO            = re.compile(r'^(19|20)\d{2}$')
RE_ANO_TITULO     = re.compile(r'\b(19[5-9]\d|20[0-3]\d)\b')
RE_KM_TITULO      = re.compile(r'(\d[\d.]+)\s*km', re.I)
RE_DIGITOS        = re.compile(r'[^\d]')
RE_UF_FINAL       = re.compile(r'\s*-\s*[A-Z]{2}$')
RE_OLX_ID_VI      = re.compile(r'/vi/(\d{7,})')
RE_OLX_ID_SLUG    = re.compile(r'-(\d{7,})(?:[/?#]|$)')
RE_OLX_ID_QUERY   = re.compile(r'[?&]id=(\d{7,})')
RE_ESTADO_SIGLA   = re.compile(r'^[A-Z]{2}$')
RE_OLX_DATA       = re.compile(r'window\.OLX_DATA\s*=\s*(\[.*\])\s*;', re.DOTALL)


# ─── Validação ────────────────────────────────────────────────────────────────
_MARCAS_ALIAS_LOWER = {m.lower() for m in ALIAS_MARCA.values()}

def is_registro_valido(record: dict) -> bool:
    titulo = (record.get('titulo') or '').lower()
    marca  = (record.get('marca')  or '').lower()
    if any(termo in titulo for termo in TERMOS_PROIBIDOS):
        return False
    return (
        marca in MARCAS_CONHECIDAS or
        marca in _MARCAS_ALIAS_LOWER or
        any(m in marca for m in MARCAS_DUAS)
    )


# ─── Extração de campos ───────────────────────────────────────────────────────
def normalizar_marca(primeira_palavra: str, titulo: str) -> str:
    p = primeira_palavra.lower().strip()
    if p in ALIAS_MARCA:
        return ALIAS_MARCA[p]
    if p in MARCAS_CONHECIDAS:
        return primeira_palavra.title()
    palavras = titulo.split()
    if len(palavras) >= 2:
        duas = (palavras[0] + " " + palavras[1]).lower()
        if duas in MARCAS_DUAS:
            return palavras[0].title() + " " + palavras[1].title()
    return primeira_palavra.title()


def extrair_modelo(titulo: str, marca: str) -> str:
    palavras = titulo.split()
    skip = 1
    if len(palavras) >= 2 and (palavras[0] + " " + palavras[1]).lower() in MARCAS_DUAS:
        skip = 2
    modelo = []
    for p in palavras[skip:]:
        if RE_PRECO_DECIMAL.match(p):  break
        if RE_POTENCIA_V.match(p):     break
        if RE_POTENCIA_CV.match(p):    break
        if p.upper().rstrip('.') in STOP_SPECS: break
        if RE_ANO.match(p):            break
        modelo.append(p)
    result = ' '.join(modelo).strip()
    return result if result else (palavras[skip] if len(palavras) > skip else 'N/D')


def cidade_da_url(href: str) -> str | None:
    try:
        slug = href.replace("https://ba.olx.com.br/", "").split("/")[0]
        slug = slug.replace("regiao-de-", "").replace("-e-alagoinhas", "")
        return slug.replace("-", " ").title() or None
    except Exception:
        return None


def extrair_ano_km(titulo: str) -> tuple[int | None, int | None]:
    ano = km = None
    m = RE_ANO_TITULO.search(titulo)
    if m: ano = int(m.group())
    m = RE_KM_TITULO.search(titulo)
    if m: km = int(RE_DIGITOS.sub('', m.group(1)))
    return ano, km


# ─── Parser principal ─────────────────────────────────────────────────────────
def extrair_dados_do_html(html_content: str) -> list[dict]:
    soup = BeautifulSoup(html_content, 'html.parser')
    anuncios: list[dict] = []
    links_vistos: set[str] = set()

    for card in soup.find_all('section', class_='olx-adcard'):
        link_tag = card.find('a', class_='olx-adcard__link')
        href = link_tag['href'] if link_tag and link_tag.get('href') else None
        if href in links_vistos:
            continue

        title_tag = card.find('h2')
        titulo = title_tag.get_text(strip=True) if title_tag else ""
        if not titulo:
            continue

        marca  = normalizar_marca(titulo.split()[0], titulo)
        modelo = extrair_modelo(titulo, marca)

        price_tag = card.find('h3', class_='olx-adcard__price')
        if not price_tag:
            continue
        nums = RE_DIGITOS.sub('', price_tag.get_text())
        if not nums:
            continue
        valor = int(nums)
        # Filtro de sanidade: ignora preços absurdos (< R$1.000 ou > R$5.000.000)
        if not (1_000 <= valor <= 5_000_000):
            continue

        # Localização
        cidade = bairro = "N/D"
        location_tag = card.find('p', class_='olx-adcard__location')
        if location_tag:
            raw = location_tag.get_text(strip=True)
            sem_uf = RE_UF_FINAL.split(raw)[0].strip()
            if ',' in sem_uf:
                cidade, bairro = [p.strip() for p in sem_uf.split(',', 1)]
            else:
                cidade = sem_uf
                bairro = "Centro/Geral"

        if RE_ESTADO_SIGLA.match(cidade):
            cidade = "N/D"
        if cidade == "N/D" and href:
            cidade = cidade_da_url(href) or "N/D"

        # Ano e KM
        ano, km_titulo = extrair_ano_km(titulo)
        km = None
        km_tag = card.find(
            lambda t: t.name and t.get('aria-label', '').endswith('quilômetros rodados')
        )
        if km_tag:
            m = re.search(r'(\d+)', km_tag['aria-label'].replace('.', ''))
            if m:
                km = int(m.group())
        if km is None:
            km = km_titulo

        item = {
            'marca':  marca,
            'modelo': modelo,
            'titulo': titulo,
            'valor':  valor,
            'cidade': cidade,
            'bairro': bairro,
            'ano':    ano,
            'km':     km,
            'link':   href,
        }

        if is_registro_valido(item):
            if href:
                links_vistos.add(href)
            anuncios.append(item)

    return anuncios


# ─── Deduplicação ─────────────────────────────────────────────────────────────
def extrair_id_olx(url: str) -> str | None:
    if not url:
        return None
    for pattern in (RE_OLX_ID_VI, RE_OLX_ID_SLUG, RE_OLX_ID_QUERY):
        m = pattern.search(url)
        if m:
            return m.group(1)
    return None


def gerar_chave_unica(record: dict) -> str:
    link   = record.get('link') or ''
    olx_id = extrair_id_olx(link)
    if olx_id:
        return f"olx_id:{olx_id}"
    titulo = (record.get('titulo') or '').lower().strip()
    return f"fallback:{titulo}|{record.get('valor')}"


# ─── Persistência ─────────────────────────────────────────────────────────────
def carregar_dados_existentes(arquivo_js: str) -> tuple[list, set]:
    if not os.path.exists(arquivo_js):
        return [], set()
    with open(arquivo_js, 'r', encoding='utf-8') as f:
        conteudo = f.read()
    m = RE_OLX_DATA.search(conteudo)
    if not m:
        return [], set()
    try:
        records_brutos = json.loads(m.group(1))
        records = [r for r in records_brutos if is_registro_valido(r)]
        chaves  = {gerar_chave_unica(r) for r in records}
        return records, chaves
    except Exception:
        return [], set()


def salvar_dados(records: list, arquivo_js: str, arquivo_csv: str) -> None:
    ts = datetime.datetime.now().strftime('%d/%m/%Y %H:%M')
    js = (
        "// Gerado automaticamente por scrapPaginas.py\n"
        f"// Total: {len(records)} anúncios | Atualizado em: {ts}\n\n"
        "window.OLX_DATA = " + json.dumps(records, ensure_ascii=False, indent=2) + ";\n"
    )
    Path(arquivo_js).write_text(js, encoding='utf-8')

    # Gera também dados_olx.json — carregado via fetch() pelo analisador (mais rápido)
    arquivo_json = str(Path(arquivo_js).with_suffix('.json'))
    Path(arquivo_json).write_text(
        json.dumps(records, ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8'
    )

    df = pd.DataFrame(records)
    for col in ('marca','modelo','titulo','valor','cidade','bairro','ano','km','link'):
        if col not in df.columns:
            df[col] = None
    df.to_csv(arquivo_csv, index=False, encoding='utf-8-sig',
              columns=['marca','modelo','titulo','valor','cidade','bairro','ano','km','link'])


# ─── GUI ──────────────────────────────────────────────────────────────────────
DARK   = "#0d0f14"
PANEL  = "#13161d"
BORDER = "#1e2330"
ACCENT = "#f0c040"
TEXT   = "#e0e4ef"
MUTED  = "#6b7391"
GREEN  = "#3ecf8e"
RED    = "#e84d3d"


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("OLX Scraper — Importar Páginas")
        self.resizable(False, False)
        self.configure(bg=DARK)
        self.files: list[str] = []
        self._pasta = os.getcwd()
        self._running = False

        self._build_styles()
        self._build_ui()
        self.geometry("560x560")
        self.eval('tk::PlaceWindow . center')

    # ── Estilos ───────────────────────────────────────────────────────────────
    def _build_styles(self):
        s = ttk.Style(self)
        s.theme_use('clam')
        s.configure('TProgressbar', background=ACCENT, troughcolor=PANEL,
                    borderwidth=0, thickness=6)

    # ── Layout ────────────────────────────────────────────────────────────────
    def _build_ui(self):
        # Header
        hdr = tk.Frame(self, bg=DARK, pady=14, padx=20)
        hdr.pack(fill='x')
        tk.Label(hdr, text="OLX Scraper", bg=DARK, fg=ACCENT,
                 font=('Segoe UI', 15, 'bold')).pack(anchor='w')
        tk.Label(hdr,
                 text="Selecione os arquivos .txt/.html das páginas OLX para importar",
                 bg=DARK, fg=MUTED, font=('Segoe UI', 9)).pack(anchor='w')

        # Body
        body = tk.Frame(self, bg=PANEL, padx=16, pady=12)
        body.pack(fill='both', expand=True)

        tk.Label(body, text="ARQUIVOS SELECIONADOS", bg=PANEL, fg=MUTED,
                 font=('Segoe UI', 8, 'bold')).pack(anchor='w')

        list_frame = tk.Frame(body, bg=PANEL)
        list_frame.pack(fill='both', expand=True, pady=(4, 0))

        scrollbar = tk.Scrollbar(list_frame, bg=BORDER, troughcolor=PANEL,
                                  bd=0, highlightthickness=0, relief='flat')
        scrollbar.pack(side='right', fill='y')

        self.listbox = tk.Listbox(
            list_frame, bg="#1a1e2e", fg=TEXT, selectbackground=BORDER,
            font=('Consolas', 9), height=8, bd=0, highlightthickness=0,
            relief='flat', yscrollcommand=scrollbar.set, activestyle='none'
        )
        self.listbox.pack(side='left', fill='both', expand=True)
        scrollbar.config(command=self.listbox.yview)

        # Botões de arquivo
        btns = tk.Frame(body, bg=PANEL, pady=8)
        btns.pack(fill='x')
        self._btn(btns, "+ Adicionar arquivos", self.add_files).pack(side='left', padx=(0, 6))
        self._btn(btns, "✕ Remover selecionado", self.remove_selected, fg=MUTED).pack(side='left')
        self._btn(btns, "🗑 Limpar tudo", self.clear_files, fg=MUTED).pack(side='left', padx=6)

        # Paths de saída
        paths = tk.Frame(body, bg=PANEL, pady=4)
        paths.pack(fill='x')
        tk.Label(paths, text="SAÍDA", bg=PANEL, fg=MUTED,
                 font=('Segoe UI', 8, 'bold')).grid(row=0, column=0, sticky='w', columnspan=2)

        tk.Label(paths, text="JS:",  bg=PANEL, fg=MUTED, font=('Segoe UI', 8)).grid(row=1, column=0, sticky='w', pady=1)
        self.js_var = tk.StringVar(value=os.path.abspath(ARQUIVO_JS))
        tk.Label(paths, textvariable=self.js_var, bg=PANEL, fg=TEXT,
                 font=('Consolas', 8)).grid(row=1, column=1, sticky='w', padx=6)

        tk.Label(paths, text="CSV:", bg=PANEL, fg=MUTED, font=('Segoe UI', 8)).grid(row=2, column=0, sticky='w', pady=1)
        self.csv_var = tk.StringVar(value=os.path.abspath(ARQUIVO_CSV))
        tk.Label(paths, textvariable=self.csv_var, bg=PANEL, fg=TEXT,
                 font=('Consolas', 8)).grid(row=2, column=1, sticky='w', padx=6)

        self._btn(paths, "📁 Mudar pasta", self.mudar_pasta, fg=MUTED,
                  font=('Segoe UI', 8)).grid(row=1, column=2, rowspan=2, padx=6)

        # Status
        self.status_frame = tk.Frame(body, bg="#0d1117", pady=8, padx=10)
        self.status_frame.pack(fill='x', pady=(8, 0))
        self.status_var = tk.StringVar(value="Aguardando…")
        self.status_lbl = tk.Label(
            self.status_frame, textvariable=self.status_var,
            bg="#0d1117", fg=MUTED, font=('Consolas', 9),
            justify='left', anchor='w', wraplength=500
        )
        self.status_lbl.pack(fill='x')

        self.progress = ttk.Progressbar(body, mode='determinate', style='TProgressbar')
        self.progress.pack(fill='x', pady=(4, 0))

        # Footer
        footer = tk.Frame(self, bg=DARK, padx=16, pady=12)
        footer.pack(fill='x')
        self.run_btn = tk.Button(
            footer, text="▶  Importar e atualizar dados_olx.js",
            bg=ACCENT, fg="#000", font=('Segoe UI', 10, 'bold'),
            relief='flat', bd=0, cursor='hand2', padx=16, pady=8,
            command=self.run_threaded
        )
        self.run_btn.pack(side='right')
        tk.Button(footer, text="Fechar", bg=PANEL, fg=MUTED,
                  font=('Segoe UI', 9), relief='flat', bd=0, cursor='hand2',
                  padx=12, pady=6, command=self.destroy).pack(side='right', padx=8)

    def _btn(self, parent, text, cmd, fg=TEXT, font=('Segoe UI', 9)):
        return tk.Button(parent, text=text, bg=PANEL, fg=fg, font=font,
                         relief='flat', bd=0, cursor='hand2',
                         highlightbackground=BORDER, highlightthickness=1,
                         command=cmd, padx=10, pady=4)

    # ── Helpers de UI ─────────────────────────────────────────────────────────
    def set_status(self, msg: str, color: str = MUTED):
        self.status_var.set(msg)
        self.status_lbl.config(fg=color)
        self.update_idletasks()

    def add_files(self):
        paths = filedialog.askopenfilenames(
            title="Selecionar páginas OLX",
            filetypes=[("HTML/TXT", "*.txt *.html *.htm"), ("Todos", "*.*")],
            initialdir=self._pasta
        )
        added = sum(1 for p in paths if p not in self.files and not self.files.append(p)
                    and self.listbox.insert('end', f"  {os.path.basename(p)}") is None)
        if added:
            self.set_status(f"{len(self.files)} arquivo(s) na fila.")

    def remove_selected(self):
        sel = self.listbox.curselection()
        if not sel:
            return
        idx = sel[0]
        self.listbox.delete(idx)
        self.files.pop(idx)
        self.set_status(f"{len(self.files)} arquivo(s) na fila.")

    def clear_files(self):
        self.files.clear()
        self.listbox.delete(0, 'end')
        self.set_status("Lista limpa.")

    def mudar_pasta(self):
        pasta = filedialog.askdirectory(title="Pasta de saída", initialdir=self._pasta)
        if pasta:
            self._pasta = pasta
            self.js_var.set(os.path.join(pasta, ARQUIVO_JS))
            self.csv_var.set(os.path.join(pasta, ARQUIVO_CSV))

    # ── Processamento em thread separada (UI não trava) ───────────────────────
    def run_threaded(self):
        if self._running:
            return
        if not self.files:
            messagebox.showwarning("Nenhum arquivo", "Adicione ao menos um arquivo antes de importar.")
            return
        self._running = True
        self.run_btn.config(state='disabled', text="⏳ Processando…")
        threading.Thread(target=self._run_worker, daemon=True).start()

    def _run_worker(self):
        js_path  = self.js_var.get()
        csv_path = self.csv_var.get()

        try:
            self.set_status("Carregando base existente…")
            existentes, chaves_existentes = carregar_dados_existentes(js_path)
            total_antes = len(existentes)

            novos_total = 0
            ignorados_total = 0
            self.progress['maximum'] = len(self.files)
            self.progress['value']   = 0

            for i, arquivo in enumerate(self.files, 1):
                nome = os.path.basename(arquivo)
                self.set_status(f"[{i}/{len(self.files)}] Lendo {nome}…")

                try:
                    conteudo = Path(arquivo).read_text(encoding='utf-8', errors='replace')
                except Exception as e:
                    self.set_status(f"⚠ Erro ao ler {nome}: {e}", RED)
                    continue

                dados = extrair_dados_do_html(conteudo)
                novos_arquivo = 0

                for record in dados:
                    chave = gerar_chave_unica(record)
                    if chave not in chaves_existentes:
                        chaves_existentes.add(chave)
                        existentes.append(record)
                        novos_arquivo += 1
                        novos_total   += 1
                    else:
                        ignorados_total += 1

                self.set_status(
                    f"[{i}/{len(self.files)}] {nome} → +{novos_arquivo} novos  "
                    f"({len(dados) - novos_arquivo} já existiam)"
                )
                self.progress['value'] = i
                self.update_idletasks()

            self.set_status("Salvando arquivos…")
            salvar_dados(existentes, js_path, csv_path)

            msg = (
                f"✅  Concluído!\n"
                f"   Base anterior       : {total_antes} anúncios\n"
                f"   Novos adicionados   : {novos_total}\n"
                f"   Duplicatas ignoradas: {ignorados_total}\n"
                f"   Total atual         : {len(existentes)} anúncios"
            )
            self.set_status(msg, GREEN)

            self.after(0, lambda: messagebox.showinfo(
                "Importação concluída",
                f"Base atualizada com sucesso!\n\n"
                f"✦ Novos anúncios: {novos_total}\n"
                f"✦ Duplicatas ignoradas: {ignorados_total}\n"
                f"✦ Total na base: {len(existentes)} anúncios\n\n"
                f"Arquivo salvo em:\n{js_path}"
            ))

        except Exception as e:
            self.set_status(f"❌ Erro inesperado: {e}", RED)

        finally:
            self._running = False
            self.run_btn.config(state='normal', text="▶  Importar e atualizar dados_olx.js")


if __name__ == '__main__':
    App().mainloop()
