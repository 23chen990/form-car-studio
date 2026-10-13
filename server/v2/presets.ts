import type {StyleId} from '../../shared/types.js';
import {STYLES,type Edit,type Field} from '../../shared/v2/edit-plan.js';

/** Versioned color-only mappings; historical prompt text and body-kit descriptions are not reused. */
export const PRESET_VERSION='form-presets-v1';
type ColorChoice='keep'|'white'|'black'|'silver'|'graphite'|'blue'|'green'|'red'|'yellow'|'bronze';
type ColorPreset={bodyColor:ColorChoice;wheelColor:ColorChoice};
const colors:Readonly<Record<StyleId,ColorPreset>>=Object.freeze({
  clean:{bodyColor:'keep',wheelColor:'silver'},
  sport:{bodyColor:'blue',wheelColor:'bronze'},
  dark:{bodyColor:'graphite',wheelColor:'graphite'},
  heritage:{bodyColor:'green',wheelColor:'silver'},
  track:{bodyColor:'silver',wheelColor:'graphite'},
  rally:{bodyColor:'green',wheelColor:'bronze'},
  touring:{bodyColor:'silver',wheelColor:'bronze'},
  color:{bodyColor:'red',wheelColor:'silver'},
});

export interface ExpandedPreset {
  version:string;
  edits:Readonly<Partial<Record<Field,Edit>>>;
}

/** A legacy `keep` sample is a preserve action, never a literal paint value. */
export function expandPreset(styleId:unknown):ExpandedPreset{
  if(typeof styleId!=='string'||!STYLES.includes(styleId as StyleId))throw new Error('INVALID_STYLE');
  const values=colors[styleId as StyleId],edits:Partial<Record<Field,Edit>>={};
  for(const field of ['bodyColor','wheelColor'] as const){
    const value=values[field];edits[field]=value==='keep'?{action:'preserve'}:{action:'set',value};
  }
  return Object.freeze({version:PRESET_VERSION,edits:Object.freeze(edits)});
}
