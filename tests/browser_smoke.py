"""One real-browser import, edit, synthesis, and export workflow."""

import threading
from pathlib import Path
from xml.etree import ElementTree

import pytest
from playwright.sync_api import expect
from werkzeug.serving import make_server

from mnt.designer import app as designer


@pytest.fixture
def live_url(monkeypatch):
    for name in ("layouts", "networks", "verilogs"):
        monkeypatch.setattr(designer, name, {})
    server = make_server("127.0.0.1", 0, designer.app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def test_import_edit_and_export(page, live_url):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(live_url)
    page.locator("#import-verilog-file-input").set_input_files(
        {
            "name": "and.v",
            "mimeType": "text/plain",
            "buffer": b"module top(a, b, y);\ninput a, b;\noutput y;\nassign y = a & b;\nendmodule\n",
        }
    )
    expect(page.locator("#editor-status")).to_have_attribute("data-state", "saved", timeout=30_000)
    editor = page.locator("#editor-container textarea")
    editor.focus()
    page.keyboard.press("ControlOrMeta+End")
    page.keyboard.insert_text("\n// Browser edit\n")
    expect(page.locator("#editor-status")).to_have_attribute("data-state", "saved")
    page.locator("#ortho-button").click()
    expect(page.locator("#layout-gates")).not_to_have_text("0 occupied tiles", timeout=30_000)
    page.locator("#layout-export-menu").click()
    with page.expect_download() as download:
        page.locator("#export-fgl-layout-button").click()
    assert download.value.suggested_filename == "layout.fgl"
    layout = ElementTree.fromstring(Path(download.value.path()).read_text())
    assert layout.find(".//gate") is not None
    assert not errors
