FROM python:3.10

WORKDIR /app

COPY ./ /app/

COPY ./requirements.txt /app/

RUN pip install -r ./requirements.txt

COPY ./flagids.py /app/

ENV PYTHONUNBUFFERED=1

STOPSIGNAL SIGINT

CMD ["python3", "./flagids.py"]
