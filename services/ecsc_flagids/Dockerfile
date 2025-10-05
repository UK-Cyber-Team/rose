FROM python:3.10

WORKDIR /app

# COPY ./ /app/

COPY ./requirements.txt /app/

RUN pip install -r ./requirements.txt

COPY ./main.py /app/

ENV PYTHONUNBUFFERED=1

STOPSIGNAL SIGINT

CMD ["python3", "./main.py"]
