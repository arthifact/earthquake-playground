#!/bin/bash
# The whole validation, end to end: cases -> SPECFEM2D (5 runs, about 6 min in parallel) -> Earthquake Playground (20 runs in
# headless Chrome, about 6 min) -> exact Lamb solution (3 min) -> comparison and figures.
# Needs SPECFEM2D built in $SPECFEM2D (default ~/Desktop/Research/specfem2d) and a Python with numpy, scipy,
# matplotlib and obspy in $PY (default ~/Desktop/Research/specfem2d_work/.venv/bin/python).
set -e
cd "$(dirname "$0")"
PY="${PY:-$HOME/Desktop/Research/specfem2d_work/.venv/bin/python}"
"$PY" cases.py
"$PY" specfem.py --run --jobs 5
./run_qv.sh
"$PY" lamb.py
"$PY" threed.py
"$PY" compare.py
