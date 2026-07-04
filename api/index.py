import os
import sys
import traceback
from fastapi import FastAPI
from fastapi.responses import HTMLResponse


try:
    ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    BACKEND_DIR = os.path.join(ROOT_DIR, "backend")

    if BACKEND_DIR not in sys.path:
        sys.path.insert(0, BACKEND_DIR)

    from main import app

except Exception:
    error_text = traceback.format_exc()

    app = FastAPI()

    @app.get("/{path:path}")
    def import_error_debug(path: str = ""):
        return HTMLResponse(
            f"""
            <html>
                <head>
                    <title>SAGIP Import Error</title>
                    <style>
                        body {{
                            font-family: Arial, sans-serif;
                            padding: 32px;
                            background: #f8fbff;
                            color: #0f172a;
                        }}
                        pre {{
                            white-space: pre-wrap;
                            background: #111827;
                            color: #f8fafc;
                            padding: 20px;
                            border-radius: 12px;
                            overflow-x: auto;
                        }}
                    </style>
                </head>
                <body>
                    <h1>SAGIP backend import failed</h1>
                    <p>Copy the error below and send it to ChatGPT.</p>
                    <pre>{error_text}</pre>
                </body>
            </html>
            """
        )
