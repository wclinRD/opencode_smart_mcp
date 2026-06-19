
def calculate_hash(data):
    import hashlib
    return hashlib.sha256(data.encode()).hexdigest()

def validate_input(value, min_len=1, max_len=100):
    if not value or len(value) < min_len:
        raise ValueError(f"Input too short: {len(value)}")
    if len(value) > max_len:
        raise ValueError(f"Input too long: {len(value)}")
    return value.strip()

class DataProcessor:
    def __init__(self, config):
        self.config = config

    def process(self, data):
        validated = validate_input(data)
        hashed = calculate_hash(validated)
        return {"hash": hashed, "length": len(validated)}
