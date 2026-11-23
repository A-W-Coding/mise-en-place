import { Link } from 'react-router';

/** Any path the client doesn't know. */
export function NotFoundPage() {
    return (
        <section>
            <h1>Page not found</h1>
            <p>
                <Link to="/">Back to recipes</Link>
            </p>
        </section>
    );
}
