"""WSGI entry point, including the database pool needed by API requests."""

import atexit

from webservice import application, db

db.open()
atexit.register(db.close)

if __name__ == "__main__":
    application.run(host="0.0.0.0", threaded=True)
