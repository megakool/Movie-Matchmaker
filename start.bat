@echo off
set MARQUEE_DEV_MODE=1
for /f "usebackq tokens=1,* delims==" %%A in (".env") do set %%A=%%B
cd /d "C:\Users\Eli Brooks\OneDrive\Documents\Movie Connections\marquee"
python app.py