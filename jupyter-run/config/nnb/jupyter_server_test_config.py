"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
from pathlib import Path

from jupyterlab.galata import configure_jupyter_server
configure_jupyter_server(c)

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"
c.FileCheckpoints.checkpoint_dir = '../'

# Disable autosave: the UI test scripts (ui/*.spec.ts) call page.notebook.save()
# explicitly at specific points; if JupyterLab's own autosave timer also fires
# in between, the client's cached "last known" file revision goes stale
# relative to disk by the time a later explicit save/download happens, and
# JupyterLab throws up a blocking "File Changed on disk" conflict dialog.
# Standard Galata testing fix (same pattern JupyterLab's own extension
# cookiecutter template uses).
c.LabApp.app_settings_dir = str(Path(__file__).resolve().parent.parent / "app-settings")