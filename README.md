# 🛡️ LoanGuard AI
> **Financial Protection & Growth Suite for Indian Consumers**

AI-powered analysis of Indian bank, NBFC, and credit card loan agreements — detecting RBI violations, calculating EMI deviations, auto-generating regulatory escalation letters, and delivering results in your preferred Indian language.

---

## ✨ What It Does

| Feature | Description |
|---|---|
| 📄 **Document Analysis** | Upload loan agreements and get instant AI-powered clause-by-clause review |
| ⚖️ **RBI Compliance Check** | Automatically flags violations against RBI guidelines and Fair Practices Code |
| 💸 **EMI Deviation Calculator** | Detects discrepancies between promised and actual EMI structures |
| 📬 **Escalation Letter Generator** | Produces ready-to-send complaint letters to banks, NBFCs, or the RBI Ombudsman |
| 📊 **Risk Scoring** | Rates agreement risk level so consumers know what they're signing |
| 🌐 **Multilingual Support** | Translates analysis and reports into Hindi, Tamil, Telugu, and more via Sarvam AI |

---

## 🧱 Tech Stack

### Backend
- **FastAPI** — high-performance async API framework
- **OpenAI** (`gpt-4o`) — LLM inference for clause analysis and letter generation
- **Sarvam AI** — Indian language translation for multilingual output
- **ChromaDB** — vector storage for document embeddings and semantic search
- **ReportLab** — PDF generation for escalation letters

### Frontend
- **React + Vite + TypeScript** — fast, type-safe UI development
- **TailwindCSS** — utility-first styling
- **Framer Motion** — smooth, production-grade animations

---

## 🚀 Quick Start

### Prerequisites
- Python 3.9+
- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [Sarvam AI API key](https://www.sarvam.ai)

---

### 1. Clone the Repository
```bash
git clone https://github.com/your-org/loanguard-ai.git
cd loanguard-ai
```

---

### 2. Backend Setup
```bash
cd backend
python -m venv venv

# Activate the virtual environment
source venv/bin/activate        # macOS/Linux
venv\Scripts\activate           # Windows

pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# → Open .env and add your OPENAI_API_KEY and SARVAM_API_KEY

# Start the development server
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`.  
Interactive docs at `http://localhost:8000/docs`.

---

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

The UI will be available at `http://localhost:5173`.

---

## 🗂️ Project Structure
```
loanguard-ai/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app entry point
│   │   ├── routers/          # API route handlers
│   │   ├── services/
│   │   │   ├── analysis.py   # Clause analysis via OpenAI
│   │   │   ├── translation.py # Indian language translation via Sarvam
│   │   │   └── pdf_gen.py    # Escalation letter PDF generation
│   │   └── models/           # Pydantic schemas
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   ├── pages/            # Route-level views
│   │   └── lib/              # API client, utilities
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

---

## ⚙️ Environment Variables

Create a `.env` file in the `backend/` directory based on `.env.example`:
```env
# OpenAI — clause analysis, risk scoring, letter generation
OPENAI_API_KEY=your_openai_api_key_here

# Sarvam AI — Indian language translation
SARVAM_API_KEY=your_sarvam_api_key_here

CHROMA_PERSIST_DIR=./chroma_db
```

> **Supported languages via Sarvam:** Hindi (`hi-IN`), Tamil (`ta-IN`), Telugu (`te-IN`), Kannada (`kn-IN`), Malayalam (`ml-IN`), Bengali (`bn-IN`), Marathi (`mr-IN`), Gujarati (`gu-IN`), and more.

---

## 🤝 Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">Built with ❤️ to help Indian consumers navigate complex financial agreements — in the language they understand best</p>
