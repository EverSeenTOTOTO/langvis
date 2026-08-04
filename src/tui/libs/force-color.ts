// chalk & marked-terminal snapshot their color level at module load from
// supports-color's FORCE_COLOR. Imported first so both pick up truecolor SGR.
process.env.FORCE_COLOR = '3';
