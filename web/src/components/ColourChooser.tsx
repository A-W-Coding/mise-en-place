/**
 * @module web/src/components/ColourChooser
 * Choosing a tag's colour (3b, as the wireframes have it): ten presets, or
 * any colour, through the phone's own colour picker or a `#rrggbb` code,
 * with a preview pill showing how the tag will look. Used for a new tag in
 * the editor, and Change colour in Options › Tags.
 */

import { useId, useState } from 'react';
import { TAG_COLOUR } from '../../../shared/limits';
import { pillColours, TAG_PRESETS } from '../tags/colour';
import { TagPill } from './TagPill';
import styles from './ColourChooser.module.css';

interface ColourChooserProps {
    /** The tag's name, for the preview. */
    name: string;
    /** `#rrggbb`, lowercase. */
    value: string;
    onChange: (hex: string) => void;
}

export function ColourChooser({ name, value, onChange }: ColourChooserProps) {
    const codeId = useId();
    const isPreset = TAG_PRESETS.some((preset) => preset.hex === value);
    // What's typed in the code box, which may not be a colour yet
    const [code, setCode] = useState(value);
    const codeValid = TAG_COLOUR.test(code.startsWith('#') ? code : `#${code}`);

    const choose = (hex: string) => {
        setCode(hex);
        onChange(hex);
    };

    return (
        <div className={styles.chooser}>
            <div className={styles.previewRow}>
                <span className={styles.previewLabel}>Preview</span>
                <TagPill name={name || 'tag'} color={value} />
            </div>
            <div role="radiogroup" aria-label="Colour" className={styles.presets}>
                {TAG_PRESETS.map((preset) => (
                    <button
                        key={preset.hex}
                        type="button"
                        role="radio"
                        aria-checked={preset.hex === value}
                        aria-label={preset.name}
                        className={styles.swatch}
                        style={pillColours(preset.hex)}
                        onClick={() => choose(preset.hex)}
                    >
                        Aa
                    </button>
                ))}
            </div>
            <div className={`${styles.any} ${isPreset ? '' : styles.anyChosen}`}>
                <label className={styles.picker} style={pillColours(value)}>
                    <span className="visually-hidden">Any colour</span>
                    <input
                        type="color"
                        className={styles.native}
                        value={value}
                        onChange={(event) => choose(event.target.value.toLowerCase())}
                    />
                    Aa
                </label>
                <span className={styles.anyText}>
                    Any colour
                    <span className={styles.anyHint}>Tap the circle, or type a code</span>
                </span>
                <label htmlFor={codeId} className="visually-hidden">
                    Colour code
                </label>
                <input
                    id={codeId}
                    className={styles.code}
                    value={code}
                    maxLength={7}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={codeValid ? undefined : true}
                    // Enter here mustn't submit the form the chooser sits in
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') event.preventDefault();
                    }}
                    onChange={(event) => {
                        const typed = event.target.value.trim();
                        setCode(typed);
                        const hex = (typed.startsWith('#') ? typed : `#${typed}`).toLowerCase();
                        if (TAG_COLOUR.test(hex)) onChange(hex);
                    }}
                />
            </div>
            <p className={styles.hint}>The pill's text turns dark or light to stay readable, so any colour works.</p>
        </div>
    );
}
