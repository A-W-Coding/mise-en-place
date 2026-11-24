/**
 * @module web/src/editor/LineRow
 * One ingredient line in the editor: Amount, Ingredient and a ⋮ menu (Move
 * up, Move down, Add note, Remove line), on one row at every screen size. A
 * note shows under its line only when it has one (technical spec §3.4).
 *
 * Once the method has sections of its own (3b), the menu also chooses the
 * line's section, and moving a line keeps it within its section.
 */

import { Menu } from '../components/Menu';
import { IngredientPicker } from './IngredientPicker';
import { lineErrorKey, type DraftAction, type DraftErrors, type LineDraft, type SectionDraft } from './draft';
import styles from './Editor.module.css';

interface LineRowProps {
    line: LineDraft;
    /** Its number among all the lines, from 1, for the boxes' names. */
    n: number;
    canMoveUp: boolean;
    canMoveDown: boolean;
    /** The sections it can be put in, or null when the method has none of its own yet. */
    sections: SectionDraft[] | null;
    errors: DraftErrors;
    dispatch: (action: DraftAction) => void;
    /** Check this line's amount as you leave the box. */
    onAmountBlur: (line: LineDraft) => void;
    onRemove: (line: LineDraft) => void;
}

export function LineRow({ line, n, canMoveUp, canMoveDown, sections, errors, dispatch, onAmountBlur, onRemove }: LineRowProps) {
    const amountError = errors[lineErrorKey(line.key, 'amount')];
    const ingredientError = errors[lineErrorKey(line.key, 'ingredient')];
    const noteError = errors[lineErrorKey(line.key, 'note')];
    const errorId = (field: string) => `line-${line.key}-${field}-error`;
    const hasError = Boolean(amountError || ingredientError || noteError);

    return (
        <li className={`${styles.line} ${hasError ? styles.lineInvalid : ''}`}>
            <div className={styles.lineRow}>
                <input
                    className={`${styles.input} ${styles.amount}`}
                    aria-label={`Amount, line ${n}`}
                    aria-invalid={amountError ? true : undefined}
                    aria-describedby={amountError ? errorId('amount') : undefined}
                    placeholder="Amount"
                    autoComplete="off"
                    autoFocus={line.focus === 'amount'}
                    value={line.amount}
                    onChange={(event) => dispatch({ type: 'line', key: line.key, patch: { amount: event.target.value } })}
                    onBlur={() => onAmountBlur(line)}
                />
                <IngredientPicker
                    lineNumber={n}
                    text={line.ingredientText}
                    picked={line.ingredient}
                    error={ingredientError}
                    errorId={errorId('ingredient')}
                    onTextChange={(text) => dispatch({ type: 'ingredientText', key: line.key, text })}
                    onPick={(ingredient) =>
                        dispatch({ type: 'line', key: line.key, patch: { ingredient, ingredientText: ingredient.name } })
                    }
                />
                <Menu
                    label={`Options for line ${n}`}
                    buttonClassName={styles.lineMenu}
                    items={[
                        {
                            label: 'Move up',
                            disabled: !canMoveUp,
                            onSelect: () => dispatch({ type: 'move', key: line.key, by: -1 }),
                        },
                        {
                            label: 'Move down',
                            disabled: !canMoveDown,
                            onSelect: () => dispatch({ type: 'move', key: line.key, by: 1 }),
                        },
                        line.showNote
                            ? {
                                  label: 'Remove note',
                                  onSelect: () => dispatch({ type: 'line', key: line.key, patch: { showNote: false, note: '' } }),
                              }
                            : {
                                  label: 'Add note',
                                  onSelect: () => dispatch({ type: 'line', key: line.key, patch: { showNote: true, focus: 'note' } }),
                              },
                        ...(sections ? sectionChoices(line, sections, dispatch) : []),
                        { label: 'Remove line', danger: true, onSelect: () => onRemove(line) },
                    ]}
                />
            </div>
            {amountError && (
                <p id={errorId('amount')} className={styles.error}>
                    {amountError}
                </p>
            )}
            {ingredientError && (
                <p id={errorId('ingredient')} className={styles.error}>
                    {ingredientError}
                </p>
            )}
            {line.showNote && (
                <input
                    className={`${styles.input} ${styles.note}`}
                    aria-label={`Note, line ${n}`}
                    aria-invalid={noteError ? true : undefined}
                    aria-describedby={noteError ? errorId('note') : undefined}
                    placeholder="Note, such as finely diced"
                    autoFocus={line.focus === 'note'}
                    value={line.note}
                    onChange={(event) => dispatch({ type: 'line', key: line.key, patch: { note: event.target.value } })}
                />
            )}
            {noteError && (
                <p id={errorId('note')} className={styles.error}>
                    {noteError}
                </p>
            )}
        </li>
    );
}

/** The menu's Section choice: no section, or one of the method's, by name. */
function sectionChoices(line: LineDraft, sections: SectionDraft[], dispatch: (action: DraftAction) => void) {
    const choose = (sectionKey: string | null) => () => dispatch({ type: 'lineSection', key: line.key, sectionKey });
    return [
        { label: 'No section', group: 'Section', checked: !line.sectionKey, onSelect: choose(null) },
        ...sections.map((section, index) => ({
            label: section.name.trim() || `Section ${index + 1}`,
            group: 'Section',
            checked: line.sectionKey === section.key,
            onSelect: choose(section.key),
        })),
    ];
}
